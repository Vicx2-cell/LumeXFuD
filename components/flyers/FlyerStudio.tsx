'use client'

import { ChangeEvent, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { FlyerTemplate, flyerAspectOptions, flyerTemplateOptions } from './FlyerTemplate'
import { flyerBrandAudit } from './mock-data'
import { campaignCopy, money, selectedMeal as chooseMeal, type FlyerCampaignType, type FlyerDraft, type FlyerMealData, type FlyerVendorData } from './flyer-content'
import type { FlyerAspect, FlyerTemplateId } from './types'

type VendorListRow = {
  id: string
  shop_name: string
  logo_url: string | null
  shop_photo_url: string | null
  city_id: string | null
  zone_id: string | null
  is_active: boolean
}

type VendorDetailResponse = {
  vendor: {
    id: string
    shop_name: string
    logo_url: string | null
    shop_photo_url: string | null
    city_id?: string | null
    zone_id?: string | null
  }
  menu: Array<{
    id: string
    name: string
    price_kobo: number
    image_url: string | null
    is_available?: boolean | null
  }>
}

type DeliveryLocation = {
  city_id: string
  city_name: string
  zone_id: string
  zone_name: string
}

type FlyerJob = FlyerDraft & {
  id: string
  title: string
  note: string
}

type ZipEntry = { name: string; blob: Blob }

const controlInputClass =
  'lx-field w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/28'

const sampleLogoOptions = [
  { label: 'LumeX', src: '/icons/icon-512-v2.png' },
  { label: 'Amber icon', src: '/icons/icon-192-v2.png' },
  { label: 'Apple icon', src: '/icons/apple-touch-icon-v2.png' },
] as const

const sampleFoodOptions = [
  { label: 'Rice bowl', src: '/premium/dish-1.jpg' },
  { label: 'Suya plate', src: '/premium/dish-2.jpg' },
  { label: 'Campus combo', src: '/premium/dish-3.jpg' },
  { label: 'Hero platter', src: '/premium/hero-food.jpg' },
] as const

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read selected image.'))
    }
    reader.onerror = () => reject(new Error('Could not read selected image.'))
    reader.readAsDataURL(file)
  })
}

function copyComputedStyles(source: HTMLElement, target: HTMLElement) {
  const computed = window.getComputedStyle(source)
  let cssText = ''
  for (const property of computed) {
    cssText += `${property}:${computed.getPropertyValue(property)};`
  }
  target.setAttribute('style', cssText)
}

function cloneForExport(node: HTMLElement): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement

  const walk = (source: HTMLElement, target: HTMLElement) => {
    copyComputedStyles(source, target)
    const sourceChildren = Array.from(source.children) as HTMLElement[]
    const targetChildren = Array.from(target.children) as HTMLElement[]
    sourceChildren.forEach((child, index) => {
      const targetChild = targetChildren[index]
      if (targetChild) walk(child, targetChild)
    })
  }

  walk(node, clone)

  const sourceImages = Array.from(node.querySelectorAll('img'))
  const clonedImages = Array.from(clone.querySelectorAll('img'))
  sourceImages.forEach((img, index) => {
    const cloneImg = clonedImages[index]
    if (!cloneImg) return
    cloneImg.setAttribute('src', img.currentSrc || img.src)
    cloneImg.setAttribute('crossorigin', 'anonymous')
  })

  return clone
}

function crc32(buffer: Uint8Array) {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }

  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

async function createZipBlob(entries: ZipEntry[]) {
  const fileParts: ArrayBuffer[] = []
  const centralParts: ArrayBuffer[] = []
  let offset = 0
  const encoder = new TextEncoder()
  const { dosTime, dosDate } = dosDateTime()

  const pushU16 = (arr: number[], value: number) => {
    arr.push(value & 0xff, (value >>> 8) & 0xff)
  }
  const pushU32 = (arr: number[], value: number) => {
    arr.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }

  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer())
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(bytes)

    const localHeader: number[] = []
    pushU32(localHeader, 0x04034b50)
    pushU16(localHeader, 20)
    pushU16(localHeader, 0)
    pushU16(localHeader, 0)
    pushU16(localHeader, dosTime)
    pushU16(localHeader, dosDate)
    pushU32(localHeader, crc)
    pushU32(localHeader, bytes.length)
    pushU32(localHeader, bytes.length)
    pushU16(localHeader, nameBytes.length)
    pushU16(localHeader, 0)

    fileParts.push(
      Uint8Array.from(localHeader).buffer,
      nameBytes.buffer.slice(nameBytes.byteOffset, nameBytes.byteOffset + nameBytes.byteLength),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )

    const centralHeader: number[] = []
    pushU32(centralHeader, 0x02014b50)
    pushU16(centralHeader, 20)
    pushU16(centralHeader, 20)
    pushU16(centralHeader, 0)
    pushU16(centralHeader, 0)
    pushU16(centralHeader, dosTime)
    pushU16(centralHeader, dosDate)
    pushU32(centralHeader, crc)
    pushU32(centralHeader, bytes.length)
    pushU32(centralHeader, bytes.length)
    pushU16(centralHeader, nameBytes.length)
    pushU16(centralHeader, 0)
    pushU16(centralHeader, 0)
    pushU16(centralHeader, 0)
    pushU16(centralHeader, 0)
    pushU32(centralHeader, 0)
    pushU32(centralHeader, offset)
    centralParts.push(
      Uint8Array.from(centralHeader).buffer,
      nameBytes.buffer.slice(nameBytes.byteOffset, nameBytes.byteOffset + nameBytes.byteLength),
    )

    offset += Uint8Array.from(localHeader).length + nameBytes.length + bytes.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0)
  const localSize = fileParts.reduce((sum, part) => sum + part.byteLength, 0)

  const end: number[] = []
  pushU32(end, 0x06054b50)
  pushU16(end, 0)
  pushU16(end, 0)
  pushU16(end, entries.length)
  pushU16(end, entries.length)
  pushU32(end, centralSize)
  pushU32(end, localSize)
  pushU16(end, 0)

  return new Blob([...fileParts, ...centralParts, Uint8Array.from(end)], { type: 'application/zip' })
}

async function exportNodeAsPngBlob(node: HTMLElement) {
  const width = node.offsetWidth
  const height = node.offsetHeight
  const clone = cloneForExport(node)

  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  clone.style.margin = '0'

  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${serialized}</foreignObject>
    </svg>
  `

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render flyer for export.'))
      image.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas export is unavailable in this browser.')
    context.scale(2, 2)
    context.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not encode flyer PNG.'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function vendorLabel(vendor: VendorListRow) {
  return vendor.shop_name
}

function mealFromRow(row: { id: string; name: string; image_url: string | null; price_kobo: number; is_available?: boolean | null }): FlyerMealData {
  return {
    id: row.id,
    name: row.name,
    image: row.image_url || '',
    price: money(row.price_kobo),
    oldPrice: null,
    discount: null,
  }
}

export function FlyerStudio() {
  const [vendors, setVendors] = useState<VendorListRow[]>([])
  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [vendorDetails, setVendorDetails] = useState<Record<string, FlyerVendorData>>({})
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [selectedMealId, setSelectedMealId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<FlyerTemplateId>('vendor-launch')
  const [aspect, setAspect] = useState<FlyerAspect>('square')
  const [useAutomaticCopy, setUseAutomaticCopy] = useState(true)
  const [headlineOverride, setHeadlineOverride] = useState('')
  const [variationCount, setVariationCount] = useState(3)
  const [exportError, setExportError] = useState('')
  const [imageError, setImageError] = useState('')
  const [generatedJobs, setGeneratedJobs] = useState<FlyerJob[]>([])
  const [isExporting, startExport] = useTransition()
  const [isGenerating, startGenerate] = useTransition()
  const exportId = useId().replace(/:/g, '')
  const previewRef = useRef<HTMLDivElement | null>(null)
  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const foodInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const [vendorsRes, locationsRes] = await Promise.all([
          fetch('/api/vendors', { signal: controller.signal }),
          fetch('/api/delivery-locations', { signal: controller.signal }),
        ])
        const vendorsJson = (await vendorsRes.json()) as { vendors?: VendorListRow[] }
        const locationsJson = (await locationsRes.json()) as { locations?: DeliveryLocation[] }
        const vendorList = vendorsJson.vendors ?? []
        setVendors(vendorList)
        setLocations(locationsJson.locations ?? [])
        setSelectedVendorId((current) => current || vendorList[0]?.id || '')
      } catch {
        // keep the editor usable with any preloaded state already on screen
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selectedVendorId || vendorDetails[selectedVendorId]) return
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/vendors/${selectedVendorId}`, { signal: controller.signal })
        const json = (await res.json()) as VendorDetailResponse | { error?: string }
        if (!('vendor' in json)) return

        const vendorRow = vendors.find((item) => item.id === selectedVendorId)
        const location = locations.find((item) => item.zone_id === vendorRow?.zone_id || item.city_id === vendorRow?.city_id) ?? null
        const meals = (json.menu ?? []).map(mealFromRow)
        const coverImage = json.vendor.shop_photo_url ?? vendorRow?.shop_photo_url ?? null
        const foodImages = [
          ...meals.map((meal) => meal.image).filter(Boolean),
          coverImage,
          json.vendor.logo_url,
        ].filter((value): value is string => Boolean(value))

        setVendorDetails((current) => ({
          ...current,
          [selectedVendorId]: {
            id: json.vendor.id,
            name: json.vendor.shop_name,
            logo: json.vendor.logo_url,
            campus: location?.zone_name || location?.city_name || vendorRow?.zone_id || vendorRow?.city_id || 'ABSU',
            deliveryArea: location ? `${location.city_name} · ${location.zone_name}` : vendorRow?.zone_id || vendorRow?.city_id || 'ABSU',
            coverImage,
            foodImages,
            meals,
            isActive: vendorRow?.is_active ?? true,
          },
        }))
      } catch {
        // ignore fetch noise
      }
    })()
    return () => controller.abort()
  }, [locations, selectedVendorId, vendorDetails, vendors])

  const activeVendor = vendorDetails[selectedVendorId] ?? null
  const currentMeal = activeVendor ? chooseMeal(activeVendor, selectedMealId) : null
  const autoCopy = useMemo(
    () => (activeVendor ? campaignCopy(selectedTemplate as FlyerCampaignType, activeVendor, currentMeal) : { headline: '', subheadline: '', cta: '' }),
    [activeVendor, currentMeal, selectedTemplate],
  )
  const copy = useMemo(
    () => (useAutomaticCopy ? autoCopy : { ...autoCopy, headline: headlineOverride.trim() || autoCopy.headline }),
    [autoCopy, headlineOverride, useAutomaticCopy],
  )

  const campaign = useMemo(() => {
    if (!activeVendor) return null
    const foodImage = currentMeal?.image || activeVendor.foodImages[0] || activeVendor.coverImage || ''
    return {
      id: `${selectedTemplate}-${activeVendor.id}-${currentMeal?.id ?? 'none'}-${aspect}`,
      template: selectedTemplate,
      title: selectedTemplate,
      note: '',
      data: {
        vendorName: activeVendor.name,
        vendorLogo: activeVendor.logo,
        foodImage,
        headline: copy.headline,
        subheadline: copy.subheadline,
        price: currentMeal?.price ?? '',
        discount: selectedTemplate === 'discount-promo' ? (currentMeal?.discount ? `${currentMeal.discount}% OFF` : '') : '',
        campus: activeVendor.campus,
        cta: copy.cta,
      },
    }
  }, [activeVendor, aspect, copy, currentMeal, selectedTemplate])

  const activeTemplateMeta = flyerTemplateOptions.find((item) => item.value === selectedTemplate) ?? flyerTemplateOptions[0]

  const loadVendorDetail = async (vendorId: string) => {
    const cached = vendorDetails[vendorId]
    if (cached) return cached

    const res = await fetch(`/api/vendors/${vendorId}`)
    const json = (await res.json()) as VendorDetailResponse | { error?: string }
    if (!('vendor' in json)) return null

    const vendorRow = vendors.find((item) => item.id === vendorId)
    const location = locations.find((item) => item.zone_id === vendorRow?.zone_id || item.city_id === vendorRow?.city_id) ?? null
    const meals = (json.menu ?? []).map(mealFromRow)
    const coverImage = json.vendor.shop_photo_url ?? vendorRow?.shop_photo_url ?? null
    const foodImages = [
      ...meals.map((meal) => meal.image).filter(Boolean),
      coverImage,
      json.vendor.logo_url,
    ].filter((value): value is string => Boolean(value))

    const vendor: FlyerVendorData = {
      id: json.vendor.id,
      name: json.vendor.shop_name,
      logo: json.vendor.logo_url,
      campus: location?.zone_name || location?.city_name || vendorRow?.zone_id || vendorRow?.city_id || 'ABSU',
      deliveryArea: location ? `${location.city_name} · ${location.zone_name}` : vendorRow?.zone_id || vendorRow?.city_id || 'ABSU',
      coverImage,
      foodImages,
      meals,
      isActive: vendorRow?.is_active ?? true,
    }

    setVendorDetails((current) => ({
      ...current,
      [vendorId]: vendor,
    }))

    return vendor
  }

  const applyVendor = async (vendorId: string) => {
    setSelectedVendorId(vendorId)
    setSelectedMealId('')
    setExportError('')
    setGeneratedJobs([])
  }

  const applyTemplatePreset = (template: FlyerTemplateId) => {
    setSelectedTemplate(template)
    setExportError('')
  }

  const updateField = <K extends 'headlineOverride' | 'useAutomaticCopy' | 'variationCount'>(field: K, value: K extends 'variationCount' ? number : K extends 'useAutomaticCopy' ? boolean : string) => {
    if (field === 'variationCount') setVariationCount(value as number)
    else if (field === 'useAutomaticCopy') setUseAutomaticCopy(value as boolean)
    else setHeadlineOverride(value as string)
  }

  const setImageField = async (field: 'vendorLogo' | 'foodImage', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageError('Please choose an image file.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (!activeVendor) return
      if (field === 'vendorLogo') {
        setVendorDetails((current) => ({
          ...current,
          [activeVendor.id]: { ...activeVendor, logo: dataUrl },
        }))
      } else {
        setVendorDetails((current) => ({
          ...current,
          [activeVendor.id]: {
            ...activeVendor,
            foodImages: [dataUrl, ...activeVendor.foodImages.filter((item) => item !== dataUrl)],
          },
        }))
      }
      setImageError('')
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not use that image.')
    }
  }

  const buildJob = (vendor: FlyerVendorData, meal: FlyerMealData | null, variant: number, template: FlyerTemplateId): FlyerJob => {
    const draftCopy = campaignCopy(template as FlyerCampaignType, vendor, meal)
    const headline = useAutomaticCopy ? draftCopy.headline : headlineOverride.trim() || draftCopy.headline
    return {
      id: `${vendor.id}-${template}-${meal?.id ?? 'none'}-${variant}`,
      title: vendor.name,
      note: meal ? meal.name : vendor.deliveryArea,
      template,
      aspect,
      vendor,
      meal,
      headlineOverride: useAutomaticCopy ? null : headlineOverride.trim() || null,
      useAutomaticCopy,
      variant,
      copy: {
        ...draftCopy,
        headline,
      },
    }
  }

  const handleExportCurrent = () => {
    const target = previewRef.current?.querySelector<HTMLElement>(`#${exportId}`)
    if (!target) return
    setExportError('')
    startExport(() => {
      void (async () => {
        try {
          const blob = await exportNodeAsPngBlob(target)
          triggerDownload(blob, `${(activeVendor?.name || 'flyer').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${selectedTemplate}-${aspect}.png`)
        } catch (error) {
          setExportError(error instanceof Error ? error.message : 'Export failed.')
        }
      })()
    })
  }

  const generateJobs = (scope: 'selected' | 'all') => {
    const vendorsToUse = scope === 'all' ? vendors.filter((vendor) => vendor.is_active) : vendors.filter((vendor) => vendor.id === selectedVendorId)
    setExportError('')
    startGenerate(() => {
      void (async () => {
        const jobs: FlyerJob[] = []
        for (const vendorRow of vendorsToUse) {
          const vendor = await loadVendorDetail(vendorRow.id)
          if (!vendor) continue
          const meal = chooseMeal(vendor, scope === 'selected' ? selectedMealId : null)
          for (let index = 0; index < variationCount; index += 1) {
            jobs.push(buildJob(vendor, meal, index + 1, selectedTemplate))
          }
        }
        setGeneratedJobs(jobs)
      })()
    })
  }

  const exportJob = async (job: FlyerJob) => {
    const node = document.getElementById(`job-${job.id}`)
    if (!(node instanceof HTMLElement)) return null
    const blob = await exportNodeAsPngBlob(node)
    triggerDownload(blob, `${job.vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${job.template}-${job.aspect}-v${job.variant}.png`)
    return blob
  }

  const exportAllAsZip = () => {
    startExport(() => {
      void (async () => {
        try {
          const blobs: ZipEntry[] = []
          for (const job of generatedJobs) {
            const node = document.getElementById(`job-${job.id}`)
            if (!(node instanceof HTMLElement)) continue
            const blob = await exportNodeAsPngBlob(node)
            blobs.push({
              name: `${job.vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${job.template}-${job.aspect}-v${job.variant}.png`,
              blob,
            })
          }
          const zip = await createZipBlob(blobs)
          triggerDownload(zip, `lumex-flyers-${selectedTemplate}-${aspect}.zip`)
        } catch (error) {
          setExportError(error instanceof Error ? error.message : 'ZIP export failed.')
        }
      })()
    })
  }

  return (
    <main className="lx-page lx-console min-h-screen px-5 py-8">
      <div className="mx-auto max-w-[1440px]">
        <section className="mb-8 rounded-[30px] border border-white/10 bg-white/[0.04] p-6 sm:p-8">
          <span className="lx-ph-badge">Flyer workshop</span>
          <h1 className="lx-ph-title mt-4 max-w-3xl">Live LumeX Fud flyer editor for real vendor campaigns</h1>
          <p className="lx-ph-sub mt-4 max-w-3xl">
            Pick a vendor, pick a meal, choose a campaign type, and the copy is generated from those layers automatically.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="lx-surface p-4">
              <p className="lx-mono">Colors</p>
              <p className="mt-2 text-sm text-white/70">{flyerBrandAudit.colors}</p>
            </div>
            <div className="lx-surface p-4">
              <p className="lx-mono">Typography</p>
              <p className="mt-2 text-sm text-white/70">{flyerBrandAudit.typography}</p>
            </div>
            <div className="lx-surface p-4">
              <p className="lx-mono">Tone</p>
              <p className="mt-2 text-sm text-white/70">{flyerBrandAudit.tone}</p>
            </div>
            <div className="lx-surface p-4">
              <p className="lx-mono">Patterns</p>
              <p className="mt-2 text-sm text-white/70">{flyerBrandAudit.patterns}</p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="lx-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="lx-mono">Controls</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">Vendor data and campaign copy</h2>
                </div>
                <button type="button" onClick={handleExportCurrent} disabled={isExporting || !campaign} className="lx-btn-amber px-4 py-2 text-sm">
                  {isExporting ? 'Preparing...' : 'Download flyer'}
                </button>
              </div>
              {exportError ? <p className="mt-3 text-sm text-red-300">{exportError}</p> : null}
              {imageError ? <p className="mt-3 text-sm text-red-300">{imageError}</p> : null}

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Vendor</span>
                  <select value={selectedVendorId} onChange={(event) => void applyVendor(event.target.value)} className={controlInputClass}>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendorLabel(vendor)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Meal</span>
                  <select value={selectedMealId} onChange={(event) => setSelectedMealId(event.target.value)} className={controlInputClass}>
                    <option value="">Auto-pick meal</option>
                    {(activeVendor?.meals ?? []).map((meal) => (
                      <option key={meal.id} value={meal.id}>
                        {meal.name} {meal.price ? `• ${meal.price}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Template type</span>
                  <select value={selectedTemplate} onChange={(event) => applyTemplatePreset(event.target.value as FlyerTemplateId)} className={controlInputClass}>
                    {flyerTemplateOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Aspect ratio</span>
                  <select value={aspect} onChange={(event) => setAspect(event.target.value as FlyerAspect)} className={controlInputClass}>
                    {flyerAspectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Copy mode</span>
                  <select value={useAutomaticCopy ? 'auto' : 'custom'} onChange={(event) => setUseAutomaticCopy(event.target.value === 'auto')} className={controlInputClass}>
                    <option value="auto">Automatic campaign copy</option>
                    <option value="custom">Custom headline override</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Headline override</span>
                  <textarea
                    value={headlineOverride}
                    onChange={(event) => updateField('headlineOverride', event.target.value)}
                    className={`${controlInputClass} min-h-[108px]`}
                    placeholder="Optional custom headline"
                    disabled={useAutomaticCopy}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Variations</span>
                  <select value={variationCount} onChange={(event) => updateField('variationCount', Number(event.target.value))} className={controlInputClass}>
                    <option value={1}>1 variation</option>
                    <option value={3}>3 variations</option>
                  </select>
                </label>

                <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Vendor logo</span>
                      <p className="mt-2 text-sm text-white/60">Pick a sample logo or upload your own.</p>
                    </div>
                    <button type="button" onClick={() => logoInputRef.current?.click()} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/8">
                      Choose logo
                    </button>
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void setImageField('vendorLogo', event)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sampleLogoOptions.map((option) => (
                      <button
                        key={option.src}
                        type="button"
                        onClick={() => activeVendor && setVendorDetails((current) => ({ ...current, [activeVendor.id]: { ...activeVendor, logo: option.src } }))}
                        className={`rounded-full border px-3 py-2 text-sm transition ${activeVendor?.logo === option.src ? 'border-[var(--color-amber)] bg-[rgba(241,170,36,0.15)] text-white' : 'border-white/10 bg-white/[0.02] text-white/72 hover:bg-white/8'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Food picture</span>
                      <p className="mt-2 text-sm text-white/60">Choose a sample dish or upload the real food photo.</p>
                    </div>
                    <button type="button" onClick={() => foodInputRef.current?.click()} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/8">
                      Choose picture
                    </button>
                    <input ref={foodInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void setImageField('foodImage', event)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {sampleFoodOptions.map((option) => (
                      <button
                        key={option.src}
                        type="button"
                        onClick={() => activeVendor && setVendorDetails((current) => ({
                          ...current,
                          [activeVendor.id]: {
                            ...activeVendor,
                            foodImages: [option.src, ...activeVendor.foodImages.filter((item) => item !== option.src)],
                          },
                        }))}
                        className={`rounded-full border px-3 py-2 text-sm transition ${activeVendor?.foodImages[0] === option.src ? 'border-[var(--color-amber)] bg-[rgba(241,170,36,0.15)] text-white' : 'border-white/10 bg-white/[0.02] text-white/72 hover:bg-white/8'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </section>

            <section className="lx-surface p-5">
              <p className="lx-mono">Preset notes</p>
              <h3 className="mt-2 text-base font-semibold text-white">{activeTemplateMeta.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                {useAutomaticCopy
                  ? 'Campaign copy is generated from the selected vendor and meal.'
                  : 'Custom headline override only changes the headline; the subheadline and CTA stay campaign-specific.'}
              </p>
            </section>
          </aside>

          <section ref={previewRef} className="space-y-6">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="lx-mono">Selected flyer</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{copy.headline || 'Preview'}</h2>
              </div>
              <p className="max-w-xl text-sm text-white/55">
                The preview updates from vendor data, meal data, and campaign content separately.
              </p>
            </div>

            <div className={`${aspect === 'square' ? 'max-w-[720px]' : 'max-w-[420px]'} transition-all`}>
              {campaign ? <FlyerTemplate campaign={campaign} aspect={aspect} exportId={exportId} /> : null}
            </div>

            <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="lx-mono">Batch generation</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">Generate for selected vendor or all active vendors</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => generateJobs('selected')} disabled={isGenerating} className="lx-btn-amber px-4 py-2 text-sm">
                    Generate for selected vendor
                  </button>
                  <button type="button" onClick={() => generateJobs('all')} disabled={isGenerating} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/8">
                    Generate for all active vendors
                  </button>
                </div>
              </div>

              {generatedJobs.length > 0 ? (
                <div className="mb-5 flex flex-wrap gap-3">
                  <button type="button" onClick={exportAllAsZip} disabled={isExporting} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/8">
                    Download all as ZIP
                  </button>
                </div>
              ) : null}

              <div className="grid gap-5 2xl:grid-cols-2">
                {generatedJobs.map((job) => (
                  <div key={job.id} className="rounded-[24px] border border-white/10 bg-white/[0.02] p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{job.title}</p>
                        <p className="text-xs text-white/55">{job.note}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void exportJob(job)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/8"
                      >
                        Download PNG
                      </button>
                    </div>
                    <FlyerTemplate
                      campaign={{
                        id: job.id,
                        template: job.template,
                        title: job.title,
                        note: job.note,
                        data: {
                          vendorName: job.vendor.name,
                          vendorLogo: job.vendor.logo,
                          foodImage: job.meal?.image || job.vendor.foodImages[0] || job.vendor.coverImage || '',
                          headline: job.copy.headline,
                          subheadline: job.copy.subheadline,
                          price: job.meal?.price ?? '',
                          discount: job.template === 'discount-promo' ? (job.meal?.discount ? `${job.meal.discount}% OFF` : '') : '',
                          campus: job.vendor.campus,
                          cta: job.copy.cta,
                        },
                      }}
                      aspect={aspect}
                      className="pointer-events-none"
                      exportId={`job-${job.id}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          </section>
        </div>
      </div>
    </main>
  )
}
