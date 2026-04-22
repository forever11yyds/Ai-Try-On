'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { HiArrowLeft, HiHeart, HiOutlineHeart, HiOutlineShare, HiShoppingCart, HiSparkles, HiXMark } from 'react-icons/hi2'

import { getCurrentAuthAccount } from '@/lib/auth'
import { createCartItem, readCartItems, writeCartItems } from '@/lib/cart'
import { readFavoriteProductSlugs, toggleFavoriteProductSlug, writeFavoriteProductSlugs } from '@/lib/favorites'
import { getAllProducts, getProductBySlug, getSkuById, loadProductBySlug, type ProductRecord } from '@/lib/products'

type DetailTab = 'reviews' | 'details' | 'store' | 'service' | 'recommend'

const TAB_ITEMS: Array<{ id: DetailTab; label: string }> = [
  { id: 'reviews', label: '大家评' },
  { id: 'details', label: '商品详情' },
  { id: 'store', label: '店铺' },
  { id: 'service', label: '售后保障' },
  { id: 'recommend', label: '推荐' },
]

const REVIEW_METRICS = [
  { label: '好评率', value: '98%' },
  { label: '综合评分', value: '4.9' },
  { label: '累计评价', value: '2.8k+' },
  { label: '追评率', value: '32%' },
]

const REVIEW_BARS = [
  { label: '5星', width: '88%' },
  { label: '4星', width: '64%' },
  { label: '3星', width: '28%' },
  { label: '2星', width: '12%' },
  { label: '1星', width: '6%' },
]

const REVIEW_ITEMS = [
  { title: '版型合适，细节清晰', subtitle: '评价来自普通用户', lines: 3 },
  { title: '上身效果不错，图片展示完整', subtitle: '评价来自回购用户', lines: 2 },
  { title: '物流和客服体验稳定', subtitle: '评价来自首购用户', lines: 3 },
]

const STORE_FEATURES = [
  '门店评分与服务等级展示',
  '发货时效与区域覆盖说明',
  '客服在线时间与响应时长',
  '店铺活动与权益说明',
]

const SERVICE_ITEMS = [
  '7 天无理由退换',
  '质量问题支持换货',
  '物流异常专人跟进',
  '售后工单实时查询',
]

const RECOMMEND_ITEMS = [
  { title: '推荐商品 A', tag: '热销' },
  { title: '推荐商品 B', tag: '上新' },
  { title: '推荐商品 C', tag: '高评分' },
  { title: '推荐商品 D', tag: '同类搭配' },
]

function generateShareCode(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let nextCode = ''

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length)
    nextCode += alphabet[randomIndex]
  }

  return nextCode
}

function normalizeVariantKey(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function parsePriceNumber(priceText: string | null | undefined) {
  if (!priceText) {
    return NaN
  }

  const numeric = Number(priceText.replace(/[^\d.]/g, ''))
  return Number.isFinite(numeric) ? numeric : NaN
}

export default function ProductDetailPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const detailKey = typeof params?.slug === 'string' && params.slug ? params.slug : 'detail-template'
  const staticProductData = getProductBySlug(detailKey) || getAllProducts()[0] || null
  const [productData, setProductData] = useState<ProductRecord | null>(staticProductData)

  const [authChecked, setAuthChecked] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('reviews')
  const [quantity, setQuantity] = useState(1)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [favoriteProductSlugs, setFavoriteProductSlugs] = useState<string[]>([])
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [cartMessage, setCartMessage] = useState<string | null>(null)

  useEffect(() => {
    const currentAccount = getCurrentAuthAccount()
    if (!currentAccount) {
      router.replace('/auth')
      return
    }

    setAuthChecked(true)
  }, [router])

  useEffect(() => {
    setFavoriteProductSlugs(readFavoriteProductSlugs())
    setActiveTab('reviews')
    setQuantity(1)
    setSelectedImageIndex(0)
  }, [detailKey])

  useEffect(() => {
    let isCancelled = false

    setProductData(staticProductData)

    const loadProductDetail = async () => {
      const nextProduct = await loadProductBySlug(detailKey)
      if (!isCancelled && nextProduct) {
        setProductData(nextProduct)
      }
    }

    void loadProductDetail()

    return () => {
      isCancelled = true
    }
  }, [detailKey])

  const isFavorite = favoriteProductSlugs.includes(detailKey)
  const gallerySkus = productData?.skus || []
  const activeGallerySku = gallerySkus[selectedImageIndex] || gallerySkus[0] || null
  const activeColorKey = normalizeVariantKey(activeGallerySku?.color || activeGallerySku?.name || activeGallerySku?.id)
  const uniqueColorSkus = useMemo(() => {
    const seen = new Set<string>()
    return gallerySkus.filter((sku) => {
      const key = normalizeVariantKey(sku.color || sku.name || sku.id)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [gallerySkus])
  const sizeOptions = useMemo(() => {
    const targetColor = normalizeVariantKey(activeGallerySku?.color)
    const source = targetColor
      ? gallerySkus.filter((sku) => normalizeVariantKey(sku.color) === targetColor)
      : gallerySkus

    return Array.from(new Set(source.map((sku) => (sku.size || '').trim()).filter(Boolean)))
  }, [activeGallerySku?.color, gallerySkus])
  const heroImageSrc = activeGallerySku?.image || productData?.coverImage || null
  const heroImageAlt = activeGallerySku ? activeGallerySku.name : productData?.name || '商品展示图'
  const currentPrice = activeGallerySku?.price || '¥0.00'
  const currentPriceNumber = parsePriceNumber(currentPrice)
  const originalPrice = Number.isFinite(currentPriceNumber) ? `¥${(currentPriceNumber * 1.2).toFixed(2)}` : '¥ --'

  const handleCopyShareCode = async () => {
    const nextShareCode = generateShareCode()

    try {
      await navigator.clipboard.writeText(nextShareCode)
    } catch {
      console.error('Failed to copy share code:', nextShareCode)
    }
  }

  const handleToggleFavorite = () => {
    setFavoriteProductSlugs((previousSlugs) => {
      const nextSlugs = toggleFavoriteProductSlug(previousSlugs, detailKey)
      writeFavoriteProductSlugs(nextSlugs)
      return nextSlugs
    })
  }

  const handleSelectColor = (colorKey: string) => {
    const targetIndex = gallerySkus.findIndex((sku) => normalizeVariantKey(sku.color || sku.name || sku.id) === colorKey)
    if (targetIndex >= 0) {
      setSelectedImageIndex(targetIndex)
    }
  }

  const handleSelectSize = (size: string) => {
    const normalizedSize = normalizeVariantKey(size)
    const targetColor = normalizeVariantKey(activeGallerySku?.color)

    const targetIndex = gallerySkus.findIndex((sku) => {
      const sameSize = normalizeVariantKey(sku.size) === normalizedSize
      if (!sameSize) {
        return false
      }
      return !targetColor || normalizeVariantKey(sku.color) === targetColor
    })

    if (targetIndex >= 0) {
      setSelectedImageIndex(targetIndex)
    }
  }

  const handleQuantityChange = (nextValue: number) => {
    setQuantity(Math.min(99, Math.max(1, nextValue)))
  }

  const handleAddToCart = () => {
    if (!productData || !activeGallerySku) {
      return
    }

    const nextCartItem = createCartItem(productData, activeGallerySku)
    const existingItems = readCartItems()
    const matchedItem = existingItems.find((item) => item.id === nextCartItem.id)

    const nextItems = matchedItem
      ? existingItems.map((item) =>
          item.id === nextCartItem.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      : [{ ...nextCartItem, quantity }, ...existingItems]

    writeCartItems(nextItems)
    setCartMessage(`${activeGallerySku.name} 已加入购物车`)

    window.setTimeout(() => {
      setCartMessage(null)
    }, 1800)
  }

  const tryOnHref = productData
    ? `/` + `?product=${encodeURIComponent(productData.slug)}${activeGallerySku ? `&variant=${encodeURIComponent(getSkuById(productData, activeGallerySku.id)?.id || activeGallerySku.id)}` : ''}`
    : '/'

  if (!authChecked) {
    return <div className="min-h-screen bg-neutral-50" />
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/products" className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900">
            <HiArrowLeft className="h-4 w-4" />
            返回商品列表
          </Link>
        </div>

        <section className="grid gap-8 xl:grid-cols-[1.28fr_0.72fr]">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
              <div className="grid gap-0 xl:grid-cols-[120px_minmax(0,1fr)]">
                <div className="border-b border-neutral-200 bg-white p-4 xl:border-b-0 xl:border-r">
                  <div className="flex gap-3 overflow-x-auto xl:flex-col xl:overflow-visible">
                    {uniqueColorSkus.map((sku) => {
                      const colorKey = normalizeVariantKey(sku.color || sku.name || sku.id)
                      const isSelected = colorKey === activeColorKey

                      return (
                        <button
                          key={sku.id}
                          type="button"
                          onClick={() => handleSelectColor(colorKey)}
                          className={`group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-md xl:h-24 xl:w-full ${
                            isSelected ? 'border-primary-500 ring-2 ring-primary-100' : 'border-neutral-200'
                          }`}
                        >
                          <img src={sku.image} alt={sku.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
                            {(sku.color || sku.name || '默认').slice(0, 8)}
                          </span>
                          {isSelected && (
                            <span className="absolute left-2 top-2 rounded-full bg-primary-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow">
                              当前
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100 xl:aspect-[4/5]">
                  <button
                    type="button"
                    onClick={() => setIsPreviewOpen(true)}
                    className="absolute bottom-4 right-4 z-20 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-xs font-semibold text-neutral-700 shadow-lg backdrop-blur-sm transition-colors hover:bg-white"
                  >
                    放大预览
                  </button>

                  {heroImageSrc ? (
                    <button type="button" onClick={() => setIsPreviewOpen(true)} className="group block h-full w-full overflow-hidden bg-neutral-100">
                      <img src={heroImageSrc} alt={heroImageAlt} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    </button>
                  ) : (
                    <div className="flex h-full items-center justify-center p-8">
                      <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/75 p-8 shadow-2xl backdrop-blur-xl">
                        <div className="flex aspect-square flex-col items-center justify-center rounded-[1.35rem] bg-white/90 text-center">
                          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">商品展示图</h1>
                          <p className="mt-3 text-sm leading-6 text-neutral-600">请先选择左侧缩略图查看对应图片。</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-lg">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">商品信息</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">{productData?.name || '商品概览'}</h2>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <p className="max-w-xl text-sm leading-6 text-neutral-600">
                        {productData?.subtitle || productData?.description || '暂无商品副标题'}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-50 px-1.5 py-1.5 ring-1 ring-neutral-200">
                        <button
                          type="button"
                          onClick={handleCopyShareCode}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-900 hover:text-white"
                          aria-label="分享"
                          title="分享"
                        >
                          <HiOutlineShare className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleFavorite}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                            isFavorite ? 'bg-primary-500 text-white' : 'text-neutral-600 hover:bg-neutral-900 hover:text-white'
                          }`}
                          aria-label={isFavorite ? '取消收藏' : '收藏'}
                          aria-pressed={isFavorite}
                          title={isFavorite ? '取消收藏' : '收藏'}
                        >
                          {isFavorite ? <HiHeart className="h-3.5 w-3.5" /> : <HiOutlineHeart className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <p className="text-xs font-medium text-neutral-500">当前售价</p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">{currentPrice}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-neutral-500">原价</p>
                      <p className="mt-1 text-sm text-neutral-400 line-through">{originalPrice}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">限时优惠</span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">满减活动</span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-700">包邮服务</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <p className="text-sm font-semibold text-neutral-900">颜色</p>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {uniqueColorSkus.map((sku) => {
                          const colorKey = normalizeVariantKey(sku.color || sku.name || sku.id)
                          const isSelected = colorKey === activeColorKey

                          return (
                            <button
                              key={sku.id}
                              type="button"
                              onClick={() => handleSelectColor(colorKey)}
                              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                                isSelected
                                  ? 'bg-primary-500 text-white shadow-sm'
                                  : 'border border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:text-primary-700'
                              }`}
                            >
                              {sku.color || sku.name || '默认颜色'}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <p className="text-sm font-semibold text-neutral-900">尺码</p>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {sizeOptions.length > 0 ? (
                          sizeOptions.map((size) => {
                            const isSelected = normalizeVariantKey(activeGallerySku?.size) === normalizeVariantKey(size)

                            return (
                              <button
                                key={size}
                                type="button"
                                onClick={() => handleSelectSize(size)}
                                className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                                  isSelected
                                    ? 'bg-primary-500 text-white shadow-sm'
                                    : 'border border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:text-primary-700'
                                }`}
                              >
                                {size}
                              </button>
                            )
                          })
                        ) : (
                          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">暂无尺码</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">当前颜色</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900">{activeGallerySku?.color || '默认颜色'}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">当前尺码</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900">{activeGallerySku?.size || '默认尺码'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-neutral-900">商品数量</p>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(quantity - 1)}
                      disabled={quantity <= 1}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-lg text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700 disabled:cursor-not-allowed disabled:border-neutral-100 disabled:text-neutral-300"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={quantity}
                      onChange={(event) => handleQuantityChange(Number(event.target.value || 1))}
                      className="h-10 w-20 rounded-xl border border-neutral-200 bg-white text-center text-sm font-semibold text-neutral-900 outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(quantity + 1)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-lg text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
                  >
                    <HiShoppingCart className="h-4 w-4" />
                    加入购物车
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
                  >
                    立即购买
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700"
                  >
                    咨询客服
                  </button>
                </div>

                {cartMessage && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                    {cartMessage}
                  </div>
                )}

              </div>
            </section>
          </aside>
        </section>

        <section className="mt-8 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-lg">
          <div className="border-b border-neutral-200 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap gap-2">
              {TAB_ITEMS.map((tab) => {
                const isActive = tab.id === activeTab

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'border border-red-200 bg-white text-red-600'
                        : 'border border-neutral-200 bg-white text-neutral-700 hover:border-primary-200 hover:text-primary-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
            {activeTab === 'reviews' && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {REVIEW_METRICS.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                      <p className="text-xs text-neutral-500">{metric.label}</p>
                      <p className="mt-2 text-2xl font-bold text-neutral-900">{metric.value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-[0.55fr_0.45fr]">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-neutral-900">评价分布</h3>
                    <div className="mt-4 space-y-3">
                      {REVIEW_BARS.map((item) => (
                        <div key={item.label} className="flex items-center gap-3">
                          <span className="w-10 text-xs text-neutral-500">{item.label}</span>
                          <div className="h-2 flex-1 rounded-full bg-neutral-100">
                            <div className="h-2 rounded-full bg-neutral-900" style={{ width: item.width }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {REVIEW_ITEMS.map((item, index) => (
                      <div key={item.title} className="rounded-2xl border border-neutral-200 bg-white p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-600">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">{item.subtitle}</span>
                            </div>
                            <div className="space-y-2">
                              {Array.from({ length: item.lines }).map((_, lineIndex) => (
                                <div key={lineIndex} className="h-3 rounded-full bg-neutral-100" />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'details' && (
              <div className="grid gap-6 lg:grid-cols-[0.4fr_0.6fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <h3 className="text-sm font-semibold text-neutral-900">商品详情</h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-600">用于展示材质、工艺、版型和穿着体验等通用说明。这里不绑定任何具体商品数据，只保留结构和展示层级。</p>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {['材质说明', '版型说明', '工艺说明', '护理说明'].map((label) => (
                        <div key={label} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                          <p className="text-xs font-medium text-neutral-500">{label}</p>
                          <p className="mt-2 text-sm text-neutral-700">占位说明文本，用于后续替换。</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">内容区域</p>
                      <h3 className="mt-3 text-lg font-semibold text-neutral-900">详情展示排版</h3>
                    </div>
                    <div className="space-y-3 text-sm leading-7 text-neutral-600">
                      <p>这里可以放置一段较长的商品说明，展示核心卖点、材质信息、尺寸建议和穿搭建议。</p>
                      <p>下方支持继续扩展图文模块、参数表、注意事项以及视频介绍，保持信息层级清晰。</p>
                      <div className="rounded-2xl bg-neutral-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">参数占位</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {['规格参数', '尺寸参考', '面料信息', '适配场景'].map((item) => (
                            <div key={item} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'store' && (
              <div className="grid gap-6 lg:grid-cols-[0.45fr_0.55fr]">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">店铺信息</p>
                  <h3 className="mt-3 text-xl font-bold text-neutral-900">店铺名称展示区</h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">这里用于展示店铺基础信息、评分、发货时效、客服在线时间等内容。</p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {['服务评分', '发货时效', '客服响应', '运费政策'].map((label) => (
                      <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3">
                        <p className="text-xs text-neutral-500">{label}</p>
                        <p className="mt-2 text-sm font-semibold text-neutral-900">占位信息</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-neutral-900">店铺展示模块</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {STORE_FEATURES.map((feature) => (
                      <div key={feature} className="rounded-2xl bg-neutral-50 p-4 text-sm text-neutral-600">
                        {feature}
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm leading-6 text-neutral-500">
                    预留店铺首页、品牌故事、优惠活动和粉丝关注入口。
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'service' && (
              <div className="grid gap-6 lg:grid-cols-[0.42fr_0.58fr]">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">售后保障</p>
                  <h3 className="mt-3 text-xl font-bold text-neutral-900">保障说明区域</h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">展示退换货规则、质保内容、客服支持和售后时效，方便用户快速了解权益。</p>
                </div>

                <div className="space-y-4">
                  {SERVICE_ITEMS.map((item, index) => (
                    <div key={item} className="rounded-2xl border border-neutral-200 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-neutral-900">{item}</p>
                          <p className="mt-1 text-sm leading-6 text-neutral-600">支持模板化说明文本，可扩展为服务时效、处理流程与联系方式。</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'recommend' && (
              <div>
                <div className="mb-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">推荐商品</p>
                    <h3 className="mt-3 text-xl font-bold text-neutral-900">相似风格推荐</h3>
                  </div>
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500">可选模块</span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {RECOMMEND_ITEMS.map((item, index) => (
                    <div key={item.title} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                      <div className="aspect-[4/5] bg-gradient-to-br from-neutral-100 via-white to-neutral-50 p-4">
                        <div className="flex h-full flex-col justify-between rounded-[1.5rem] border border-dashed border-neutral-300 bg-white/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="rounded-full bg-neutral-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
                              {item.tag}
                            </span>
                            <span className="text-xs text-neutral-400">0{index + 1}</span>
                          </div>
                          <div>
                            <div className="h-24 w-full rounded-2xl bg-gradient-to-br from-slate-200 via-white to-amber-100" />
                            <p className="mt-4 text-sm font-semibold text-neutral-900">{item.title}</p>
                            <p className="mt-1 text-xs leading-5 text-neutral-500">推荐卡片占位，用于展示更多同类商品。</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 p-4">
                        <span className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">查看详情</span>
                        <span className="rounded-full bg-neutral-900 px-3 py-2 text-xs font-semibold text-white">进入</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <Link
        href={tryOnHref}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-5 py-4 text-sm font-semibold text-white shadow-xl shadow-fuchsia-500/30 transition-all hover:-translate-y-1 hover:from-fuchsia-500 hover:via-pink-500 hover:to-rose-400"
      >
        <HiSparkles className="h-5 w-5" />
        AI 试衣
      </Link>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <button
            type="button"
            aria-label="Close image preview"
            onClick={() => setIsPreviewOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default"
          />
              <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-neutral-900">图片预览</p>
                    <p className="mt-1 text-xs text-neutral-500">{heroImageAlt}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:text-neutral-900"
                aria-label="Close preview"
              >
                <HiXMark className="h-5 w-5" />
              </button>
            </div>
            <div className="relative aspect-[16/10] bg-neutral-100">
              <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-8">
                {heroImageSrc ? (
                  <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-2xl backdrop-blur-xl">
                    <div className="border-b border-neutral-200 px-5 py-4">
                      <p className="text-sm font-semibold text-neutral-900">图片预览</p>
                      <p className="mt-1 text-xs text-neutral-500">{heroImageAlt}</p>
                    </div>
                    <div className="relative bg-neutral-100">
                      <Image src={heroImageSrc} alt={heroImageAlt} className="max-h-[72vh] w-full object-contain" width={1600} height={1600} />
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-2xl rounded-[2rem] border border-white/70 bg-white/80 p-10 shadow-2xl backdrop-blur-xl">
                    <div className="mx-auto h-32 w-32 rounded-[2rem] bg-gradient-to-br from-neutral-900 to-neutral-600 shadow-lg" />
                    <h2 className="mt-8 text-center text-3xl font-semibold tracking-tight text-neutral-900">图片预览</h2>
                    <p className="mt-4 text-center text-sm leading-6 text-neutral-600">请先选择左侧缩略图查看对应图片。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
