import { NextRequest } from 'next/server'

function isBlockedHostname(hostname: string) {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower === '::1' || lower.endsWith('.local')) return true
  if (/^127\./.test(lower)) return true
  if (/^10\./.test(lower)) return true
  if (/^192\.168\./.test(lower)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true
  return false
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')?.trim()
  if (!url) return new Response('Missing url', { status: 400 })

  let target: URL
  try {
    target = new URL(url)
  } catch {
    return new Response('Invalid url', { status: 400 })
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return new Response('Unsupported protocol', { status: 400 })
  }

  if (isBlockedHostname(target.hostname)) {
    return new Response('Blocked host', { status: 400 })
  }

  const upstream = await fetch(target, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': 'LumeX-Fud-Flyer-Preview/1.0',
    },
    cache: 'force-cache',
  })

  if (!upstream.ok) {
    return new Response('Could not fetch image', { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return new Response('URL did not return an image', { status: 400 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
