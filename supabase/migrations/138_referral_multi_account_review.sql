-- Referral correlation uses a keyed app-generated token over already-lawful
-- request metadata. It is an indicator only and never proves common identity.
CREATE OR REPLACE FUNCTION attach_referral_with_risk(
  p_referred UUID, p_code TEXT, p_ip TEXT DEFAULT NULL, p_correlation_token TEXT DEFAULT NULL
) RETURNS TABLE(attached BOOLEAN, referral_id UUID, manual_review BOOLEAN, matched_recent INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_referrer UUID; v_id UUID; v_recent INT := 0; v_review BOOLEAN := false;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN QUERY SELECT false, NULL::UUID, false, 0; RETURN;
  END IF;
  SELECT customer_id INTO v_referrer FROM referral_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR v_referrer = p_referred OR EXISTS (SELECT 1 FROM referrals WHERE referred_id = p_referred) THEN
    RETURN QUERY SELECT false, NULL::UUID, false, 0; RETURN;
  END IF;

  IF p_correlation_token IS NOT NULL AND p_correlation_token ~ '^[0-9a-f]{64}$' THEN
    SELECT count(*)::INT INTO v_recent FROM referrals
    WHERE referrer_id = v_referrer AND device_hash = p_correlation_token
      AND created_at >= now() - interval '24 hours';
    v_review := v_recent >= 2;
  END IF;

  INSERT INTO referrals (
    referrer_id, referred_id, code, signup_ip, signup_device, device_hash,
    reward_state, metadata
  ) VALUES (
    v_referrer, p_referred, upper(trim(p_code)), p_ip, p_correlation_token, p_correlation_token,
    CASE WHEN v_review THEN 'manual_review' ELSE 'pending' END,
    CASE WHEN v_review THEN jsonb_build_object(
      'review_reason', 'correlated_referral_reward_claims',
      'warning', 'Request indicators do not prove identity.'
    ) ELSE '{}'::jsonb END
  ) ON CONFLICT (referred_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN QUERY SELECT false, NULL::UUID, false, v_recent; RETURN; END IF;
  PERFORM log_gamification_event('referral_sent', v_referrer, jsonb_build_object('referred_id', p_referred));
  RETURN QUERY SELECT true, v_id, v_review, v_recent;
END $$;

REVOKE ALL ON FUNCTION attach_referral_with_risk(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION attach_referral_with_risk(UUID,TEXT,TEXT,TEXT) TO service_role;

-- The reward trigger must honor manual review before issuing either side's
-- credit. This is a reversible reward hold, not an account restriction.
CREATE OR REPLACE FUNCTION award_referral_on_completion(p_customer UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ref RECORD; v_done INT; v_to_referrer BIGINT; v_to_referred BIGINT;
  v_min BIGINT; v_expdays INT; v_exp TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE referred_id = p_customer FOR UPDATE;
  IF NOT FOUND OR v_ref.status = 'QUALIFIED_2' OR v_ref.reward_state = 'manual_review' THEN RETURN; END IF;
  SELECT count(*) INTO v_done FROM orders WHERE customer_id = p_customer AND status = 'COMPLETED';
  v_to_referrer := coalesce((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'referral_reward_referrer_kobo'), 30000);
  v_to_referred := coalesce((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'referral_reward_referred_kobo'), 20000);
  v_min := coalesce((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'reward_min_order_kobo'), 0);
  v_expdays := coalesce((SELECT (value->>'value')::int FROM settings WHERE id = 'reward_credit_expiry_days'), 30);
  v_exp := now() + (v_expdays || ' days')::interval;
  IF v_ref.status = 'PENDING' AND v_done >= 1 THEN
    PERFORM issue_reward_credit(v_ref.referrer_id, v_to_referrer, 'REFERRAL',
      'referral:1:referrer:' || v_ref.referred_id, v_exp, v_min, 'Referral reward');
    PERFORM issue_reward_credit(v_ref.referred_id, v_to_referred, 'REFERRAL',
      'referral:1:referred:' || v_ref.referred_id, v_exp, v_min, 'Welcome reward');
    UPDATE referrals SET status = 'QUALIFIED_1', first_reward_at = now() WHERE id = v_ref.id;
    PERFORM log_gamification_event('referral_converted', v_ref.referrer_id,
      jsonb_build_object('referred_id', v_ref.referred_id, 'milestone', 1));
  END IF;
  IF v_ref.status IN ('PENDING','QUALIFIED_1') AND v_done >= 2 THEN
    PERFORM issue_reward_credit(v_ref.referrer_id, v_to_referrer, 'REFERRAL',
      'referral:2:referrer:' || v_ref.referred_id, v_exp, v_min, 'Referral reward');
    PERFORM issue_reward_credit(v_ref.referred_id, v_to_referred, 'REFERRAL',
      'referral:2:referred:' || v_ref.referred_id, v_exp, v_min, 'Loyalty reward');
    UPDATE referrals SET status = 'QUALIFIED_2', second_reward_at = now() WHERE id = v_ref.id;
    PERFORM log_gamification_event('referral_converted', v_ref.referrer_id,
      jsonb_build_object('referred_id', v_ref.referred_id, 'milestone', 2));
  END IF;
END $$;
