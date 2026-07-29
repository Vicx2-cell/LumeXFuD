'use client'
import { FormEvent, useEffect, useState } from 'react'

type Account = { bank_name:string; account_name:string; account_number:string; status:string; failure_reason?:string|null }
export default function VirtualAccountPage() {
  const [account,setAccount]=useState<Account|null>(null)
  const [consent,setConsent]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [identity,setIdentity]=useState({account_number:'',bank_code:'',bvn:''})
  const load=()=>fetch('/api/customer/virtual-account',{cache:'no-store'}).then(async r=>{const d=await r.json();if(r.ok)setAccount(d.virtual_account);else setMessage(d.error)})
  useEffect(()=>{void load()},[])
  async function create(e:FormEvent){
    e.preventDefault();setBusy(true);setMessage('')
    const body={consent,...Object.fromEntries(Object.entries(identity).filter(([,v])=>v))}
    const r=await fetch('/api/customer/virtual-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const d=await r.json();setMessage(r.ok?(r.status===202?'Paystack is assigning your account.':'Account ready.'):d.error)
    if(r.ok)void load();setBusy(false)
  }
  return <main className="min-h-screen bg-[#090909] p-4 text-white"><div className="mx-auto max-w-xl py-10">
    <p className="text-xs uppercase tracking-wider text-amber-400">Payments</p><h1 className="text-3xl font-semibold">Bank transfer account</h1>
    <p className="mt-2 text-white/55">For eligible registered customers. This is a Paystack payment account, not a LumeX wallet or stored balance.</p>
    {account?.status==='ACTIVE'?<section className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
      <p className="text-sm text-white/50">{account.bank_name}</p><p className="mt-2 text-3xl font-semibold tracking-wider">{account.account_number}</p><p className="mt-2">{account.account_name}</p>
      <button onClick={async()=>{setBusy(true);const r=await fetch('/api/customer/virtual-account',{method:'PUT'});setMessage(r.ok?'Paystack is checking for confirmed transfers.':'Could not start requery');setBusy(false)}} disabled={busy} className="mt-5 rounded-xl bg-white px-4 py-2 font-semibold text-black">Recheck a transfer</button>
    </section>:<form onSubmit={create} className="mt-6 grid gap-4 rounded-2xl border border-white/10 p-5">
      <p className="text-sm text-white/65">Paystack may require a bank account linked to your identity for compliance. These fields are sent server-side; LumeX stores only masked validation details.</p>
      {([['account_number','Personal account number',10],['bank_code','Bank code',3],['bvn','BVN',11]] as const).map(([k,l,n])=><label key={k}>{l}<input type="password" inputMode="numeric" maxLength={n} className="mt-1 w-full rounded-xl bg-white/10 px-3 py-2" value={identity[k]} onChange={e=>setIdentity({...identity,[k]:e.target.value.replace(/\D/g,'')})}/></label>)}
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/><span>I expressly consent to LumeX sending my identity details to Paystack to create a Dedicated Virtual Account. I understand this does not create a stored-value wallet.</span></label>
      <button disabled={!consent||busy} className="rounded-xl bg-amber-400 px-4 py-3 font-semibold text-black disabled:opacity-50">{busy?'Requesting…':'Request account'}</button>
    </form>}
    {message&&<p className="mt-4 text-sm">{message}</p>}
  </div></main>
}
