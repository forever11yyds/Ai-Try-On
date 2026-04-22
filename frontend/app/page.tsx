'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/image-upload'
import { HiCheckCircle, HiPlus, HiSparkles, HiXMark, HiMagnifyingGlass, HiPhoto, HiShoppingCart } from 'react-icons/hi2'

import { addCartItem } from '@/lib/cart'
import { getCurrentAuthAccount } from '@/lib/auth'
import {
  fetchUserImageHistoryFromDatabase,
  syncUploadedImageToUserTable,
  syncVirtualImageToUserTable,
} from '@/lib/user-images'
import {
  createEmptyMixSelections,
  getAllProducts,
  getSkuById,
  loadCatalogProducts,
  readMixSelections,
  writeMixSelections,
  type MixSelectionList,
  type ProductRecord,
  type ProductSku,
} from '../lib/products'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Provider = 'nano-banana' | 'nano-banana-pro' | 'wan-xiang'

type GeneratedResultView = {
  view: string
  image: string
}

const VIEW_DISPLAY_LABELS: Record<string, string> = {
  front: '正面',
  back: '背面',
  left: '左侧',
}

const VIEW_ORDER = ['front', 'back', 'left']
const GENERATION_RETRY_LIMIT = 2
const MODEL_IMAGE_HISTORY_LIMIT = 12
const TRYON_RESULT_CACHE_STORAGE_KEY = 'ai-try-on-tryon-result-cache-v1'
const TRYON_RESULT_CACHE_TTL_MS = 5 * 60 * 1000
const MODEL_IMAGE_MAX_LONG_EDGE = 1024
const GARMENT_IMAGE_MAX_LONG_EDGE = 1280
const COMPRESSED_IMAGE_QUALITY = 0.85

function normalizeOptionKey(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function getImageMimeType(file: File) {
  if (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/jpeg') {
    return file.type
  }

  return 'image/jpeg'
}

async function compressImageFile(file: File, maxLongEdge: number): Promise<File> {
  if (typeof window === 'undefined') {
    return file
  }

  if (!file.type.startsWith('image/')) {
    return file
  }

  try {
    const bitmap = await createImageBitmap(file)
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (longEdge <= maxLongEdge && file.size <= 900 * 1024) {
      bitmap.close()
      return file
    }

    const scale = Math.min(1, maxLongEdge / longEdge)
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight

    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
    bitmap.close()

    const outputType = getImageMimeType(file)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputType, COMPRESSED_IMAGE_QUALITY)
    })

    if (!blob) {
      return file
    }

    const outputExtension = outputType === 'image/png' ? 'png' : outputType === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + `.${outputExtension}`, {
      type: blob.type || outputType,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  }
}

type ModelImageHistorySource = 'upload' | 'generate'

type ModelImageHistoryItem = {
  id: string
  name: string
  dataUrl: string
  source: ModelImageHistorySource
  createdAt: string
}

type TryOnResultCacheEntry = {
  results: GeneratedResultView[]
  cachedAt: string
  expiresAt: number
}

type TryOnResultCacheStore = Record<string, TryOnResultCacheEntry>

function getPromptForProvider(provider: Provider): string {
  switch (provider) {
    case 'nano-banana':
      return 'Create a clean and realistic virtual try-on image with faithful garment preservation and natural lighting.'
    case 'nano-banana-pro':
      return 'Create a high-quality virtual try-on image with precise garment details, realistic fabric draping, and professional fashion-photo aesthetics.'
    case 'wan-xiang':
      return 'Create a realistic virtual try-on image that preserves the person identity and keeps the clothing details faithful, clean, and natural.'
    default:
      return 'Create a clean and realistic virtual try-on image with faithful garment preservation and natural lighting.'
  }
}

export default function Home() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<ProductRecord[]>(getAllProducts())
  const [pageScale, setPageScale] = useState(1)
  const [modelImage, setModelImage] = useState<File | null>(null)
  const [garmentImages, setGarmentImages] = useState<File[]>([])
  const [resultImages, setResultImages] = useState<GeneratedResultView[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [modelInputMode, setModelInputMode] = useState<'upload' | 'generate' | 'history'>('upload')
  const [garmentInputMode, setGarmentInputMode] = useState<'single' | 'mix'>('single')
  const [modelPrompt, setModelPrompt] = useState<string>('一个写实的全身时尚模特，中性背景，正面站姿，光线干净自然，现代休闲风，适合用于虚拟试衣')
  const [isGeneratingModel, setIsGeneratingModel] = useState(false)
  const [modelGenerationError, setModelGenerationError] = useState<string | null>(null)
  const [modelImageHistory, setModelImageHistory] = useState<ModelImageHistoryItem[]>([])
  const [selectedHistoryImageId, setSelectedHistoryImageId] = useState<string | null>(null)
  const [selectedProductSlug, setSelectedProductSlug] = useState<string | null>(null)
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null)
  const [mixSelections, setMixSelections] = useState<MixSelectionList>(createEmptyMixSelections)
  const [skuCartMessage, setSkuCartMessage] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string>('idle')
  const [jobProgress, setJobProgress] = useState<number>(0)
  const [jobMessage, setJobMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewingResultIndex, setPreviewingResultIndex] = useState<number | null>(null)
  const previewPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRequestIdRef = useRef(0)
  
  // Create preview URLs for model and garment images
  const [modelPreviewUrl, setModelPreviewUrl] = useState<string | null>(null)
  const [garmentPreviewUrls, setGarmentPreviewUrls] = useState<string[]>([])
  const selectedProductQuery = searchParams.get('product')
  const selectedVariantQuery = searchParams.get('variant') || searchParams.get('sku')
  const selectedModeQuery = searchParams.get('mode')
  const activeProduct = selectedProductSlug ? products.find((product) => product.slug === selectedProductSlug) || null : null
  const activeSku = activeProduct ? getSkuById(activeProduct, selectedSkuId) : null
  const activeColorKey = normalizeOptionKey(activeSku?.color || activeSku?.name || activeSku?.id)
  const colorDedupedSkus = useMemo(() => {
    if (!activeProduct) {
      return [] as ProductSku[]
    }

    const seen = new Set<string>()
    return activeProduct.skus.filter((sku) => {
      const key = normalizeOptionKey(sku.color || sku.name || sku.id)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [activeProduct])
  const sizeOptionSkus = useMemo(() => {
    if (!activeProduct) {
      return [] as ProductSku[]
    }

    const sameColorSkus = activeColorKey
      ? activeProduct.skus.filter((sku) => normalizeOptionKey(sku.color || sku.name || sku.id) === activeColorKey)
      : activeProduct.skus

    const seenSize = new Set<string>()
    return sameColorSkus.filter((sku) => {
      const sizeKey = normalizeOptionKey(sku.size || sku.name || sku.id)
      if (seenSize.has(sizeKey)) {
        return false
      }
      seenSize.add(sizeKey)
      return true
    })
  }, [activeColorKey, activeProduct])

  const getImageSrc = (image: ProductRecord['coverImage'] | ProductSku['image']) => image

  useEffect(() => {
    let isCancelled = false

    const loadProductsFromDatabase = async () => {
      const nextProducts = await loadCatalogProducts()
      if (!isCancelled && nextProducts.length > 0) {
        setProducts(nextProducts)
      }
    }

    void loadProductsFromDatabase()

    return () => {
      isCancelled = true
    }
  }, [])

  const handlePageScaleChange = (nextScale: number) => {
    setPageScale(Math.min(1.25, Math.max(0.8, Number(nextScale.toFixed(2)))))
  }
  
  // Update preview URLs when images change
  useEffect(() => {
    if (modelImage) {
      const url = URL.createObjectURL(modelImage)
      setModelPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setModelPreviewUrl(null)
    }
  }, [modelImage])
  
  useEffect(() => {
    const urls = garmentImages.map(file => URL.createObjectURL(file))
    setGarmentPreviewUrls(urls)
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [garmentImages])

  useEffect(() => {
    if (selectedModeQuery === 'mix') {
      setSelectedProductSlug(null)
      setSelectedSkuId(null)
      setGarmentInputMode('mix')
      return
    }

    if (!selectedProductQuery) {
      setSelectedProductSlug(null)
      setSelectedSkuId(null)
      setGarmentInputMode('single')
      return
    }

    const product = products.find((item) => item.slug === selectedProductQuery) || null
    setSelectedProductSlug(product?.slug || null)
    setSelectedSkuId(selectedVariantQuery || product?.skus[0]?.id || null)
    setGarmentInputMode('single')
  }, [products, selectedModeQuery, selectedProductQuery, selectedVariantQuery])

  useEffect(() => {
    setMixSelections(readMixSelections())
  }, [])

  useEffect(() => {
    if (garmentInputMode !== 'single' || !selectedProductSlug || !activeProduct || !activeSku) {
      if (garmentInputMode === 'single') {
        setGarmentImages([])
      }
      return
    }

    let isCancelled = false

    const loadSelectedSku = async () => {
      try {
        const skuImageSrc = getImageSrc(activeSku.image)
        const response = await fetch(skuImageSrc)
        const blob = await response.blob()
        const fileExtension = skuImageSrc.endsWith('.jpg') ? 'jpg' : 'png'
          const file = new File([blob], `${activeProduct.slug}-${activeSku.id}.${fileExtension}`, {
          type: blob.type || 'image/png',
        })
          const compressedFile = await compressImageFile(file, GARMENT_IMAGE_MAX_LONG_EDGE)

        if (!isCancelled) {
            setGarmentImages([compressedFile])
        }
      } catch (loadError) {
        console.error('加载所选款式图片失败:', loadError)
        if (!isCancelled) {
          setError('加载所选款式图片失败')
        }
      }
    }

    void loadSelectedSku()

    return () => {
      isCancelled = true
    }
  }, [garmentInputMode, selectedProductSlug, activeProduct, activeSku])

  useEffect(() => {
    if (garmentInputMode !== 'mix') {
      return
    }

    let isCancelled = false

    const loadMixedGarmentImages = async () => {
      try {
        const selectedProducts = products.filter((product) => mixSelections.includes(product.slug))

        if (selectedProducts.length === 0) {
          if (!isCancelled) {
            setGarmentImages([])
          }
          return
        }

        const files = await Promise.all(
          selectedProducts.map(async (product) => {
            const coverImageSrc = getImageSrc(product.coverImage)
            const response = await fetch(coverImageSrc)
            const blob = await response.blob()
            const fileExtension = coverImageSrc.endsWith('.jpg') ? 'jpg' : 'png'
            const file = new File([blob], `${product.slug}-${product.part}.${fileExtension}`, {
              type: blob.type || 'image/png',
            })
            return compressImageFile(file, GARMENT_IMAGE_MAX_LONG_EDGE)
          })
        )

        if (!isCancelled) {
          setGarmentImages(files)
        }
      } catch (loadError) {
        console.error('加载混搭商品图片失败:', loadError)
        if (!isCancelled) {
          setError('加载混搭商品图片失败')
        }
      }
    }

    void loadMixedGarmentImages()

    return () => {
      isCancelled = true
    }
  }, [garmentInputMode, products, mixSelections])

  const selectedMixProducts = useMemo(() => {
    return mixSelections
      .map((selectedSlug) => products.find((product) => product.slug === selectedSlug) || null)
      .filter((product): product is (typeof products)[number] => Boolean(product))
  }, [mixSelections, products])

  const handleClearMixSelections = () => {
    const nextSelections = createEmptyMixSelections()
    setMixSelections(nextSelections)
    writeMixSelections(nextSelections)
  }

  useEffect(() => {
    return () => {
      if (previewPressTimerRef.current) {
        clearTimeout(previewPressTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadHistoryFromDatabase = async () => {
      try {
        const { uploadedImages, virtualImages } = await fetchUserImageHistoryFromDatabase()
        const uploadedItems = uploadedImages.map((imageUrl, index) => ({
          id: `uploaded-${index}-${imageUrl}`,
          name: imageUrl.split('/').pop() || `uploaded-${index + 1}.png`,
          dataUrl: imageUrl,
          source: 'upload' as const,
          createdAt: new Date().toISOString(),
        }))
        const virtualItems = virtualImages.map((imageUrl, index) => ({
          id: `virtual-${index}-${imageUrl}`,
          name: imageUrl.split('/').pop() || `virtual-${index + 1}.png`,
          dataUrl: imageUrl,
          source: 'generate' as const,
          createdAt: new Date().toISOString(),
        }))

        if (isMounted) {
          setModelImageHistory(normalizeModelImageHistory([...uploadedItems, ...virtualItems]))
        }
      } catch (loadError) {
        console.error('Failed to load model image history from database:', loadError)
      }
    }

    void loadHistoryFromDatabase()

    return () => {
      isMounted = false
    }
  }, [])

  const displayedResults = VIEW_ORDER.map((view) => resultImages.find((result) => result.view === view) || null)

  const clearPreviewPressTimer = () => {
    if (previewPressTimerRef.current) {
      clearTimeout(previewPressTimerRef.current)
      previewPressTimerRef.current = null
    }
  }

  const handlePreviewPressStart = (resultIndex: number) => {
    if (!modelPreviewUrl || !displayedResults[resultIndex]) {
      return
    }

    clearPreviewPressTimer()
    previewPressTimerRef.current = setTimeout(() => {
      setPreviewingResultIndex(resultIndex)
    }, 250)
  }

  const handlePreviewPressEnd = () => {
    clearPreviewPressTimer()
    setPreviewingResultIndex(null)
  }

  const getPreviewedResultImage = (resultIndex: number) => {
    if (previewingResultIndex === resultIndex && modelPreviewUrl) {
      return modelPreviewUrl
    }

    return displayedResults[resultIndex]?.image || null
  }

  const getResultViewLabel = (view: string, index: number) => {
    return VIEW_DISPLAY_LABELS[view] || VIEW_DISPLAY_LABELS[VIEW_ORDER[index]] || `视角 ${index + 1}`
  }

  const canUseLocalStorage = () => {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  }

  const readTryOnResultCacheStore = (): TryOnResultCacheStore => {
    if (!canUseLocalStorage()) {
      return {}
    }

    try {
      const rawValue = window.localStorage.getItem(TRYON_RESULT_CACHE_STORAGE_KEY)
      if (!rawValue) {
        return {}
      }

      const parsedValue = JSON.parse(rawValue)
      if (!parsedValue || typeof parsedValue !== 'object') {
        return {}
      }

      return parsedValue as TryOnResultCacheStore
    } catch {
      return {}
    }
  }

  const writeTryOnResultCacheStore = (store: TryOnResultCacheStore) => {
    if (!canUseLocalStorage()) {
      return
    }

    window.localStorage.setItem(TRYON_RESULT_CACHE_STORAGE_KEY, JSON.stringify(store))
  }

  const buildTryOnResultCacheKey = (username: string, skuIds: string[]) => {
    const normalizedUsername = username.trim()
    const normalizedSkuIds = skuIds
      .map((item) => item.trim())
      .filter(Boolean)
      .sort()

    if (!normalizedUsername || normalizedSkuIds.length === 0) {
      return null
    }

    return `${normalizedUsername}::${normalizedSkuIds.join('|')}`
  }

  const getCurrentTryOnSkuIds = () => {
    if (garmentInputMode === 'single') {
      return selectedSkuId ? [selectedSkuId] : []
    }

    return selectedMixProducts
      .map((product) => product.skus[0]?.id || product.slug)
      .filter(Boolean)
  }

  const readTryOnResultsByKey = (cacheKey: string): GeneratedResultView[] | null => {
    const cacheStore = readTryOnResultCacheStore()
    const now = Date.now()

    // Opportunistically clean expired entries while reading.
    const prunedStore = Object.entries(cacheStore).reduce<TryOnResultCacheStore>((nextStore, [key, value]) => {
      if (value && typeof value.expiresAt === 'number' && value.expiresAt > now) {
        nextStore[key] = value
      }

      return nextStore
    }, {})

    if (Object.keys(prunedStore).length !== Object.keys(cacheStore).length) {
      writeTryOnResultCacheStore(prunedStore)
    }

    const targetEntry = prunedStore[cacheKey]
    if (!targetEntry || !Array.isArray(targetEntry.results)) {
      return null
    }

    return targetEntry.results
  }

  const writeTryOnResultsByKey = (cacheKey: string, results: GeneratedResultView[]) => {
    if (!results.length) {
      return
    }

    const now = Date.now()
    const cacheStore = readTryOnResultCacheStore()
    cacheStore[cacheKey] = {
      results,
      cachedAt: new Date(now).toISOString(),
      expiresAt: now + TRYON_RESULT_CACHE_TTL_MS,
    }
    writeTryOnResultCacheStore(cacheStore)
  }

  const handleSelectSku = (sku: ProductSku) => {
    if (!activeProduct) {
      return
    }

    setSelectedSkuId(sku.id)
    setGarmentInputMode('single')
  }

  const handleAddSkuToCart = () => {
    if (!activeProduct || !activeSku) {
      return
    }

    addCartItem(activeProduct, activeSku)
    setSkuCartMessage(`${activeSku.name} 已加入购物车`)

    window.setTimeout(() => {
      router.push('/products#cart')
    }, 180)

    window.setTimeout(() => {
      setSkuCartMessage(null)
    }, 1800)
  }

  const normalizeModelImageHistory = (items: ModelImageHistoryItem[]) => {
    const deduplicated: ModelImageHistoryItem[] = []
    const seenDataUrls = new Set<string>()

    items
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .forEach((item) => {
        if (seenDataUrls.has(item.dataUrl)) {
          return
        }

        seenDataUrls.add(item.dataUrl)
        deduplicated.push(item)
      })

    return deduplicated.slice(0, MODEL_IMAGE_HISTORY_LIMIT)
  }

  const addModelImageToHistory = (dataUrl: string, source: ModelImageHistorySource, name: string) => {
    const historyItem: ModelImageHistoryItem = {
      id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      dataUrl,
      source,
      createdAt: new Date().toISOString(),
    }

    setModelImageHistory((previousHistory) => {
      return normalizeModelImageHistory([
        historyItem,
        ...previousHistory.filter((item) => item.dataUrl !== dataUrl),
      ])
    })

    return historyItem
  }

  const handleModelImageFromHistory = async (historyItem: ModelImageHistoryItem) => {
    setModelGenerationError(null)
    const file = await dataUrlToFile(historyItem.dataUrl, historyItem.name)
    setModelImage(await compressImageFile(file, MODEL_IMAGE_MAX_LONG_EDGE))
    setModelInputMode('history')
    setSelectedHistoryImageId(historyItem.id)
  }

  const openImagePreview = (imageUrl: string) => {
    setPreviewImageUrl(imageUrl)
    setIsImagePreviewOpen(true)
  }

  const closeImagePreview = () => {
    setIsImagePreviewOpen(false)
    setPreviewImageUrl(null)
  }

  const handleModelImageChange = (file: File | null) => {
    setModelInputMode('upload')
    setModelGenerationError(null)
    setSelectedHistoryImageId(null)

    if (!file) {
      setModelImage(null)
      return
    }

    void (async () => {
      const compressedFile = await compressImageFile(file, MODEL_IMAGE_MAX_LONG_EDGE)
      setModelImage(compressedFile)

      void syncUploadedImageToUserTable(compressedFile)
        .then((imageUrl) => {
          if (!imageUrl) {
            throw new Error('上传图片同步到数据库失败')
          }

          const historyItem = addModelImageToHistory(
            imageUrl,
            'upload',
            compressedFile.name || `uploaded-model-${Date.now()}.png`
          )
          setSelectedHistoryImageId(historyItem.id)
        })
        .catch((historyError) => {
          console.error('上传模特图同步到数据库失败:', historyError)
        })
    })()
  }

  const dataUrlToFile = async (dataUrl: string, filename: string) => {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type || 'image/png' })
  }

  const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

  const handleGenerateModelImage = async () => {
    if (!modelPrompt.trim()) {
      setModelGenerationError('请先描述你想生成的模特图')
      return
    }

    setIsGeneratingModel(true)
    setModelGenerationError(null)
    setError(null)

    try {
      let lastError: unknown = null

      for (let attempt = 1; attempt <= GENERATION_RETRY_LIMIT; attempt += 1) {
        try {
          setModelGenerationError(attempt > 1 ? `正在重试生成模特图（${attempt}/${GENERATION_RETRY_LIMIT}）...` : null)

          const formData = new FormData()
          formData.append('provider', 'wan-xiang')
          formData.append('prompt', modelPrompt.trim())
          formData.append('aspect_ratio', '3:4')
          formData.append('resolution', '2K')

          const response = await fetch(`${API_URL}/api/v1/virtual-tryon/model-image`, {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.detail || '生成模特图失败')
          }

          const responseData = await response.json()
          if (!responseData.image) {
            throw new Error('生成模特图失败，未返回图片')
          }

          const generatedFile = await dataUrlToFile(
            responseData.image,
            `generated-model-${Date.now()}.png`
          )
          const compressedGeneratedFile = await compressImageFile(generatedFile, MODEL_IMAGE_MAX_LONG_EDGE)
          const imageUrl = await syncVirtualImageToUserTable(compressedGeneratedFile)
          if (!imageUrl) {
            throw new Error('生成模特图同步到数据库失败')
          }

          const historyItem = addModelImageToHistory(imageUrl, 'generate', compressedGeneratedFile.name)
          setModelImage(compressedGeneratedFile)
          setModelInputMode('generate')
          setSelectedHistoryImageId(historyItem.id)
          setModelGenerationError(null)
          return
        } catch (attemptError) {
          lastError = attemptError
          if (attempt < GENERATION_RETRY_LIMIT) {
            await sleep(1200)
            continue
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error('生成模特图时发生错误')
    } catch (err) {
      console.error('生成模特图失败:', err)

      if (err instanceof TypeError && err.message.includes('fetch')) {
        setModelGenerationError(`无法连接到接口服务 ${API_URL}，请确认后端已启动。`)
      } else if (err instanceof Error) {
        setModelGenerationError(err.message)
      } else {
        setModelGenerationError('生成模特图时发生错误')
      }
    } finally {
      setIsGeneratingModel(false)
    }
  }

  const handleGenerate = async () => {
    if (!modelImage || garmentImages.length === 0) {
      setError('请先上传模特图和至少一张商品图')
      return
    }

    const currentAccount = getCurrentAuthAccount()
    const currentSkuIds = getCurrentTryOnSkuIds()
    const tryOnCacheKey = currentAccount
      ? buildTryOnResultCacheKey(currentAccount.username, currentSkuIds)
      : null

    if (tryOnCacheKey) {
      const cachedResults = readTryOnResultsByKey(tryOnCacheKey)
      if (cachedResults && cachedResults.length > 0) {
        setError(null)
        setResultImages(cachedResults)
        setPreviewingResultIndex(null)
        setJobStatus('completed')
        setJobProgress(100)
        setJobMessage('已命中缓存结果')
        return
      }
    }

    generationRequestIdRef.current += 1
    const requestId = generationRequestIdRef.current

    setIsGenerating(true)
    setError(null)
    setResultImages([])
    setPreviewingResultIndex(null)
    setJobStatus('queued')
    setJobProgress(0)
    setJobMessage('开始生成...')

    try {
      let lastError: unknown = null
      let latestResults: GeneratedResultView[] = []

      for (let attempt = 1; attempt <= GENERATION_RETRY_LIMIT; attempt += 1) {
        try {
          setResultImages([])
          setPreviewingResultIndex(null)
          setJobStatus('queued')
          setJobProgress(0)
          setJobMessage(
            attempt > 1
              ? `正在重试生成（${attempt}/${GENERATION_RETRY_LIMIT}）`
              : '开始生成...'
          )

          const formData = new FormData()
          formData.append('model_image', modelImage)

          garmentImages.forEach((garment) => {
            formData.append('garment_images', garment)
          })

          formData.append('provider', 'wan-xiang')
          formData.append('prompt', getPromptForProvider('wan-xiang'))

          const startResponse = await fetch(`${API_URL}/api/v1/virtual-tryon/jobs`, {
            method: 'POST',
            body: formData,
          })

          if (!startResponse.ok) {
            const errorData = await startResponse.json()
            throw new Error(errorData.detail || '生成试衣图失败')
          }

          const startData = await startResponse.json()
          const jobId = startData.job_id

          if (generationRequestIdRef.current !== requestId) {
            return
          }

          while (generationRequestIdRef.current === requestId) {
            const jobResponse = await fetch(`${API_URL}/api/v1/virtual-tryon/jobs/${jobId}`)

            if (!jobResponse.ok) {
              const errorData = await jobResponse.json()
              throw new Error(errorData.detail || '获取生成进度失败')
            }

            const jobData = await jobResponse.json()

            if (generationRequestIdRef.current !== requestId) {
              return
            }

            setJobStatus(jobData.status || 'processing')
            setJobProgress(typeof jobData.progress === 'number' ? jobData.progress : 0)
            setJobMessage(jobData.current_step || '')

            const imagesFromResponse: unknown[] = Array.isArray(jobData.images) ? jobData.images : []
            const normalizedResults: GeneratedResultView[] = imagesFromResponse
              .map((item: unknown, index: number) => {
                if (typeof item === 'string') {
                  return {
                    view: jobData.views?.[index] || VIEW_ORDER[index] || `view-${index + 1}`,
                    image: item,
                  }
                }

                if (item && typeof item === 'object') {
                  const typedItem = item as { view?: string; image?: string }
                  if (typedItem.image) {
                    return {
                      view: typedItem.view || jobData.views?.[index] || VIEW_ORDER[index] || `view-${index + 1}`,
                      image: typedItem.image,
                    }
                  }
                }

                return null
              })
              .filter((item): item is GeneratedResultView => item !== null)

            if (normalizedResults.length > 0) {
              latestResults = normalizedResults
              setResultImages(normalizedResults)
            }

            if (jobData.status === 'completed') {
              if (tryOnCacheKey && latestResults.length > 0) {
                writeTryOnResultsByKey(tryOnCacheKey, latestResults)
              }
              setJobStatus('completed')
              setJobProgress(100)
              setJobMessage('已完成')
              return
            }

            if (jobData.status === 'failed') {
              throw new Error(jobData.error || '生成失败')
            }

            await sleep(1500)
          }
        } catch (attemptError) {
          lastError = attemptError
          if (generationRequestIdRef.current !== requestId) {
            return
          }

          if (attempt < GENERATION_RETRY_LIMIT) {
            setJobStatus('queued')
            setJobMessage(`正在重试生成（${attempt + 1}/${GENERATION_RETRY_LIMIT}）`)
            await sleep(1200)
            continue
          }
        }

        break
      }

      throw lastError instanceof Error ? lastError : new Error('生成试衣图时发生错误')
    } catch (err) {
      console.error('生成试衣图失败:', err)
      
      // Provide more specific error messages
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError(`无法连接到接口服务 ${API_URL}，请确认后端已启动。`)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('生成试衣图时发生错误')
      }
    } finally {
      setIsGenerating(false)
      setJobStatus('idle')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 overflow-x-hidden" style={{ backgroundColor: '#fafafa' }}>
      <div className="fixed right-4 top-4 z-[60] rounded-full border border-neutral-200 bg-white px-3 py-2 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handlePageScaleChange(pageScale - 0.05)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-sm font-semibold text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700"
            aria-label="缩小页面"
            title="缩小页面"
          >
            −
          </button>
          <span className="min-w-14 text-center text-xs font-medium text-neutral-600">{Math.round(pageScale * 100)}%</span>
          <button
            type="button"
            onClick={() => handlePageScaleChange(pageScale + 0.05)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-sm font-semibold text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700"
            aria-label="放大页面"
            title="放大页面"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handlePageScaleChange(1)}
            className="ml-1 rounded-full border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-primary-200 hover:text-primary-700"
            aria-label="重置页面缩放"
            title="重置页面缩放"
          >
            重置
          </button>
        </div>
      </div>

      <div
        className="origin-top-left"
        style={{
          width: `${100 / pageScale}%`,
          transform: `scale(${pageScale})`,
          transformOrigin: 'top left',
        }}
      >
        {/* Main Content */}
        <main className="flex min-h-screen flex-1">
        {/* Header */}
        <header className="bg-white border-b border-neutral-200 sticky top-0 z-10 header-shadow" style={{ backgroundColor: '#ffffff', borderColor: '#e5e5e5', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)' }}>
          <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* Main Title */}
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">AI-try-on</h1>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-1">用 AI 快速生成真实感试衣效果</p>
                </div>
              </div>
              <Link
                href="/products"
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-primary-200 hover:text-primary-700"
              >
                商品列表
              </Link>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-5 sm:p-6 lg:p-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-10 max-w-7xl mx-auto">
            {/* Left Panel - Input Form */}
            <div className="space-y-5 sm:space-y-6 lg:space-y-7">
              {/* Model Image Upload */}
              <Card className="!p-5 sm:!p-6">
                <CardHeader className="!mb-4 !pb-0">
                  <CardTitle className="!text-base sm:!text-lg font-semibold">模特图</CardTitle>
                </CardHeader>
                <CardContent className="!pt-4">
                  <div className="flex rounded-xl border border-neutral-200 bg-neutral-50 p-1 mb-4">
                    <button
                      type="button"
                      onClick={() => setModelInputMode('upload')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        modelInputMode === 'upload'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      上传图片
                    </button>
                    <button
                      type="button"
                      onClick={() => setModelInputMode('generate')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        modelInputMode === 'generate'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      文生模特
                    </button>
                    <button
                      type="button"
                      onClick={() => setModelInputMode('history')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        modelInputMode === 'history'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      历史记录
                    </button>
                  </div>

                  {modelInputMode === 'upload' ? (
                    <ImageUpload
                      label="上传模特/人物图片"
                      description="上传一张人物或模特图片"
                      onImageChange={handleModelImageChange}
                      currentImage={modelImage}
                      layout="grid"
                      gridCols={3}
                    />
                  ) : modelInputMode === 'generate' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">描述模特形象</label>
                        <textarea
                          value={modelPrompt}
                          onChange={(event) => setModelPrompt(event.target.value)}
                          rows={5}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                          placeholder="例如：写实女性模特，站立姿势，日常休闲穿搭，中性背景，20-30岁，长发，自然柔光..."
                        />
                        <p className="mt-2 text-xs text-neutral-500">
                          生成后的模特图会直接作为试衣的人像输入。
                        </p>
                      </div>

                      <Button
                        type="button"
                        onClick={handleGenerateModelImage}
                        disabled={isGeneratingModel || !modelPrompt.trim()}
                        variant="secondary"
                        className="w-full flex items-center justify-center gap-2"
                      >
                        {isGeneratingModel ? (
                          <>
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1V5a7 7 0 107 7h-2a5 5 0 11-5-5z"></path>
                            </svg>
                            <span>正在生成模特图</span>
                          </>
                        ) : (
                          <span>生成模特图</span>
                        )}
                      </Button>

                      {modelGenerationError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {modelGenerationError}
                        </div>
                      )}

                      {modelPreviewUrl && (
                        <div className="space-y-2">
                          <div className="relative aspect-square overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 shadow-sm">
                            <img src={modelPreviewUrl} alt="生成的模特预览图" className="h-full w-full object-contain" />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-neutral-500">该图片将作为试衣模特图使用。</p>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-3 py-2 text-xs"
                              onClick={() => {
                                setModelImage(null)
                                setModelGenerationError(null)
                              }}
                            >
                              清空
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-neutral-700">选择历史模特图</p>
                          <p className="text-xs text-neutral-500 mt-1">你上传和生成的模特图都会保存在这里。</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-3 py-2 text-xs"
                          onClick={() => setModelInputMode('upload')}
                        >
                          上传新图
                        </Button>
                      </div>

                      {modelPreviewUrl && (
                        <div className="space-y-2">
                          <div className="relative aspect-square overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 shadow-sm">
                            <img src={modelPreviewUrl} alt="当前选中的模特预览图" className="h-full w-full object-contain" />
                          </div>
                          <p className="text-xs text-neutral-500">
                            当前选择：{selectedHistoryImageId ? '来自历史记录' : '自定义图片'}
                          </p>
                        </div>
                      )}

                      {modelImageHistory.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
                          {modelImageHistory.map((historyItem) => {
                            const isSelected = selectedHistoryImageId === historyItem.id

                            return (
                              <button
                                key={historyItem.id}
                                type="button"
                                onClick={() => {
                                  void handleModelImageFromHistory(historyItem)
                                }}
                                className={`text-left rounded-xl border p-2 transition-all ${
                                  isSelected
                                    ? 'border-primary-500 bg-primary-50 shadow-sm'
                                    : 'border-neutral-200 bg-white hover:border-primary-300 hover:shadow-sm'
                                }`}
                              >
                                <div className="relative aspect-square overflow-hidden rounded-lg bg-neutral-50">
                                  <img src={historyItem.dataUrl} alt={historyItem.name} className="h-full w-full object-contain" />
                                  <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                                    {historyItem.source === 'generate' ? '生成' : '上传'}
                                  </div>
                                </div>
                                <div className="mt-2 space-y-1">
                                  <p className="truncate text-xs font-medium text-neutral-800">{historyItem.name}</p>
                                  <p className="text-[10px] text-neutral-500">
                                    {new Date(historyItem.createdAt).toLocaleString()}
                                  </p>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center">
                          <p className="text-sm text-neutral-500">暂无历史模特图。</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Garment Images Upload */}
              <Card className="!p-5 sm:!p-6">
                <CardHeader className="!mb-4 !pb-0">
                  <CardTitle className="!text-base sm:!text-lg font-semibold">
                    {garmentInputMode === 'mix' ? '商品混搭' : '单商品试穿'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="!pt-4">
                  <div className="mb-4 flex rounded-xl border border-neutral-200 bg-neutral-50 p-1">
                    <button
                      type="button"
                      onClick={() => setGarmentInputMode('single')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        garmentInputMode === 'single'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      单商品试衣
                    </button>
                    <button
                      type="button"
                      onClick={() => setGarmentInputMode('mix')}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        garmentInputMode === 'mix'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      商品混搭
                    </button>
                  </div>

                  {garmentInputMode === 'mix' ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
                        点击加号进入独立混搭选择页，商品不按外套、内搭等种类限制，0 个或多个都可以返回试衣。
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={handleClearMixSelections}
                          className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-700 transition-colors hover:text-neutral-900"
                        >
                          清空选择
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push('/mix')}
                          className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
                        >
                          <HiPlus className="h-4 w-4" />
                          去混搭选择页
                        </button>
                      </div>

                      <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p>
                            当前已选 {selectedMixProducts.length} 个商品。
                            {selectedMixProducts.length === 0 ? ' 你也可以不选，直接返回试衣。' : ' 返回后会自动带入混搭结果。'}
                          </p>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {selectedMixProducts.length > 0 ? (
                            selectedMixProducts.map((product) => (
                              <div
                                key={product.slug}
                                className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50"
                              >
                                <div className="relative aspect-[4/5] bg-neutral-100">
                                  <img src={getImageSrc(product.coverImage)} alt={product.name} className="h-full w-full object-cover" />
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-white">
                                    <p className="text-xs font-semibold">{product.name}</p>
                                    <p className="mt-0.5 text-[10px] leading-4 text-white/75">点击加号页可继续增删</p>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-xs text-neutral-500 sm:col-span-2 xl:col-span-4">
                              还没有混搭商品，点击加号进入选择页。
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : activeProduct && activeSku ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900">当前商品：{activeProduct.name}</p>
                            <p className="mt-1 text-xs text-neutral-500">选择喜欢的款式后即可直接开始试衣</p>
                          </div>
                          <Link
                            href={`/products/${activeProduct.slug}`}
                            className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-600 hover:text-neutral-900"
                          >
                            查看详情
                          </Link>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={handleAddSkuToCart}
                            className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
                          >
                            <HiShoppingCart className="h-4 w-4" />
                            加入购物车
                          </button>
                        </div>
                        {skuCartMessage && (
                          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                            {skuCartMessage}
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">颜色</p>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {colorDedupedSkus.map((sku) => {
                              const colorKey = normalizeOptionKey(sku.color || sku.name || sku.id)
                              const isSelected = colorKey === activeColorKey

                              return (
                                <button
                                  key={sku.id}
                                  type="button"
                                  onClick={() => handleSelectSku(sku)}
                                  className={`overflow-hidden rounded-2xl border text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                                    isSelected
                                      ? 'border-primary-500 bg-primary-50 shadow-sm'
                                      : 'border-neutral-200 bg-white'
                                  }`}
                                >
                                  <div className="relative aspect-square bg-neutral-50">
                                    <img src={getImageSrc(sku.image)} alt={sku.name} className="h-full w-full object-cover" />
                                    <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
                                      {(sku.color || sku.name || '默认颜色').slice(0, 8)}
                                    </span>
                                    {isSelected && (
                                      <span className="absolute left-2 top-2 rounded-full bg-primary-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow">
                                        已选中
                                      </span>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">尺码</p>
                          <div className="grid grid-cols-2 gap-2">
                            {sizeOptionSkus.length > 0 ? (
                              sizeOptionSkus.map((sku) => {
                                const isSelected = activeSku.id === sku.id
                                const sizeLabel = (sku.size || '').trim() || sku.name || '默认尺码'

                                return (
                                  <button
                                    key={sku.id}
                                    type="button"
                                    onClick={() => handleSelectSku(sku)}
                                    className={`min-h-14 rounded-xl border px-2 py-2 text-center transition-colors ${
                                      isSelected
                                        ? 'border-primary-500 bg-primary-500 text-white shadow-sm'
                                        : 'border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:text-primary-700'
                                    }`}
                                  >
                                    <span className="flex flex-col items-center justify-center leading-tight">
                                      <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-neutral-400'}`}>尺码</span>
                                      <span className="mt-1 text-sm font-semibold">{sizeLabel}</span>
                                    </span>
                                  </button>
                                )
                              })
                            ) : (
                              <div className="col-span-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 text-xs text-neutral-500">
                                当前颜色暂无可选尺码
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
                      <p className="text-sm font-medium text-neutral-700">请先选择一个单商品款式</p>
                      <p className="mt-1 text-xs text-neutral-500">如果想混搭，请切换到混搭并点击加号进入独立选择页。</p>
                      <div className="mt-4 flex justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setGarmentInputMode('mix')}
                          className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-700 transition-colors hover:text-neutral-900"
                        >
                          切换到混搭
                        </button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Generate Button */}
              <Button
                onClick={() => handleGenerate()}
                disabled={!modelImage || garmentImages.length === 0 || isGenerating}
                className="w-full py-3 sm:py-3.5 text-sm sm:text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                variant="primary"
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                      <span>生成中...</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <HiSparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span>开始生成</span>
                  </span>
                )}
              </Button>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200/60 text-red-700 px-4 py-3 rounded-lg shadow-sm">
                  <p className="text-xs sm:text-sm font-medium">{error}</p>
                </div>
              )}

              {(isGenerating || jobStatus === 'queued' || jobStatus === 'processing') && (
                <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-sm font-medium text-neutral-700">{jobMessage || '生成中...'}</p>
                    <p className="text-xs font-semibold text-neutral-500">{jobProgress}%</p>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${jobProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Right Panel - Image Output */}
            <div>
              <Card className="h-full !p-5 sm:!p-6">
                <CardHeader className="!mb-4 !pb-0">
                    <CardTitle className="!text-base sm:!text-lg font-semibold">生成结果</CardTitle>
                </CardHeader>
                <CardContent className="!pt-4">
                  <div className="w-full min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] flex flex-col items-center justify-center gap-5 sm:gap-6">
                    {isGenerating || displayedResults.some(Boolean) ? (
                      <>
                        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {displayedResults.map((result, index) => {
                            const displayedImage = getPreviewedResultImage(index)

                            return (
                              <div
                                key={`${VIEW_ORDER[index]}-${index}`}
                                className="relative aspect-square rounded-xl overflow-hidden border-2 border-neutral-200 shadow-md select-none cursor-zoom-in"
                                onClick={() => result && openImagePreview(displayedImage || result.image)}
                                onPointerDown={() => result && handlePreviewPressStart(index)}
                                onPointerUp={handlePreviewPressEnd}
                                onPointerLeave={handlePreviewPressEnd}
                                onPointerCancel={handlePreviewPressEnd}
                                onContextMenu={(event) => event.preventDefault()}
                                style={{ touchAction: 'none' }}
                              >
                                {result ? (
                                  <img
                                    src={displayedImage || result.image}
                                        alt={previewingResultIndex === index ? '原始模特图' : `${getResultViewLabel(result.view, index)}试衣结果`}
                                    className="w-full h-full object-contain bg-neutral-50"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-neutral-50">
                                    <div className="text-center">
                                      <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                                        <p className="text-xs sm:text-sm text-neutral-500">正在生成{getResultViewLabel(VIEW_ORDER[index], index)}</p>
                                    </div>
                                  </div>
                                )}
                                <div className="absolute top-3 left-3">
                                  <span className="rounded-full bg-black/55 text-white text-[10px] sm:text-xs px-3 py-1 backdrop-blur-sm">
                                    {getResultViewLabel(result?.view || VIEW_ORDER[index], index)}
                                  </span>
                                </div>
                                <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
                                  <span className="rounded-full bg-black/55 text-white text-[10px] sm:text-xs px-3 py-1 backdrop-blur-sm">
                                    {result ? (previewingResultIndex === index ? '显示原始模特图' : '长按可预览原图') : '等待该视角生成'}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <Button
                          onClick={() => setIsModalOpen(true)}
                          variant="outline"
                          className="flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-medium"
                        >
                          <HiMagnifyingGlass className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span>预览与对比</span>
                        </Button>
                      </>
                    ) : (
                      <div className="text-center px-4">
                        <div className="w-24 h-24 sm:w-28 sm:h-28 mx-auto mb-4 sm:mb-5 rounded-xl image-placeholder flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f5f5f5 0%, #fafafa 100%)', boxShadow: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)' }}>
                          <HiPhoto className="w-12 h-12 sm:w-14 sm:h-14 text-neutral-400" />
                        </div>
                          <p className="text-base sm:text-lg font-semibold text-neutral-700 mb-1.5 sm:mb-2">暂无生成结果</p>
                          <p className="text-xs sm:text-sm text-neutral-500 max-w-sm mx-auto">生成完成后，结果会显示在这里</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        </main>
      </div>

      {/* Single Image Preview Modal */}
      {isImagePreviewOpen && previewImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={closeImagePreview}
        >
          <div
            className="relative flex h-[95vh] w-[95vw] items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={closeImagePreview}
              className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                aria-label="关闭预览"
            >
              <HiXMark className="h-5 w-5" />
            </button>
            <img
              src={previewImageUrl}
                alt="生成结果预览图"
              className="max-h-full max-w-full object-contain shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Comparison Modal */}
      {isModalOpen && displayedResults.some(Boolean) && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="relative bg-white rounded-lg shadow-xl max-w-7xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#ffffff', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 10px 10px -5px rgb(0 0 0 / 0.04)' }}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4 flex items-center justify-between z-10" style={{ borderColor: '#e5e5e5' }}>
                <h2 className="text-lg sm:text-xl font-bold text-neutral-900 tracking-tight">图片对比</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 sm:p-2 rounded-lg hover:bg-neutral-100 transition-colors"
                  aria-label="关闭弹窗"
              >
                <HiXMark className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-600" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-6 lg:p-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
                {/* Model Image */}
                <div className="space-y-2.5 sm:space-y-3">
                    <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">模特图</h3>
                  {modelPreviewUrl ? (
                    <div className="relative w-full aspect-square rounded-xl overflow-hidden border-2 border-neutral-200 bg-neutral-50 shadow-sm">
                      <img
                        src={modelPreviewUrl}
                          alt="模特图"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-full aspect-square rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center bg-neutral-50">
                        <p className="text-sm text-neutral-400">暂无模特图</p>
                    </div>
                  )}
                </div>

                {/* Garment Images */}
                <div className="space-y-2.5 sm:space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                      商品图（{garmentPreviewUrls.length}）
                  </h3>
                  {garmentPreviewUrls.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                      {garmentPreviewUrls.map((url, index) => (
                        <div
                          key={index}
                          className="relative aspect-square rounded-xl overflow-hidden border-2 border-neutral-200 bg-neutral-50 shadow-sm"
                        >
                          <img
                            src={url}
                                alt={`商品图 ${index + 1}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="w-full aspect-square rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center bg-neutral-50">
                        <p className="text-sm text-neutral-400">暂无商品图</p>
                    </div>
                  )}
                </div>

                {/* Generated Result */}
                <div className="space-y-2.5 sm:space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                      生成结果（{resultImages.filter(Boolean).length}）
                  </h3>
                  {displayedResults.some(Boolean) ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                      {displayedResults.map((result, index) => {
                        const displayedImage = getPreviewedResultImage(index)

                        return (
                          <div
                            key={`${VIEW_ORDER[index]}-${index}`}
                            className="relative aspect-square rounded-xl overflow-hidden border-2 border-primary-500 bg-neutral-50 shadow-md select-none cursor-zoom-in"
                            onClick={() => result && openImagePreview(displayedImage || result.image)}
                            onPointerDown={() => result && handlePreviewPressStart(index)}
                            onPointerUp={handlePreviewPressEnd}
                            onPointerLeave={handlePreviewPressEnd}
                            onPointerCancel={handlePreviewPressEnd}
                            onContextMenu={(event) => event.preventDefault()}
                            style={{ borderColor: '#ef4444', touchAction: 'none' }}
                          >
                            {result ? (
                              <img
                                src={displayedImage || result.image}
                                  alt={previewingResultIndex === index ? '原始模特图' : `${getResultViewLabel(result.view, index)}试衣结果`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-neutral-50">
                                <div className="text-center">
                                  <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                                    <p className="text-xs sm:text-sm text-neutral-500">正在生成{getResultViewLabel(VIEW_ORDER[index], index)}</p>
                                </div>
                              </div>
                            )}
                            <div className="absolute top-3 left-3">
                              <span className="rounded-full bg-black/55 text-white text-[10px] sm:text-xs px-3 py-1 backdrop-blur-sm">
                                {getResultViewLabel(result?.view || VIEW_ORDER[index], index)}
                              </span>
                            </div>
                            <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
                              <span className="rounded-full bg-black/55 text-white text-[10px] sm:text-xs px-3 py-1 backdrop-blur-sm">
                                  {result ? (previewingResultIndex === index ? '显示原始模特图' : '长按可预览原图') : '等待该视角生成'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="w-full aspect-square rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center bg-neutral-50">
                        <p className="text-sm text-neutral-400">暂无生成结果</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
