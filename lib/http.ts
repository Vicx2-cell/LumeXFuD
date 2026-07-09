export async function readJsonResponse<T>(res: Response): Promise<T | null> {
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    return await res.json() as T
  } catch {
    return null
  }
}
