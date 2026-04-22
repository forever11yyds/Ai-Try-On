'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HiArrowLeft, HiCheckCircle, HiPlus, HiSparkles, HiXMark } from 'react-icons/hi2'

import {
  createEmptyMixSelections,
  getAllProducts,
  loadCatalogProducts,
  readMixSelections,
  writeMixSelections,
  type MixSelectionList,
  type ProductRecord,
} from '@/lib/products'
import { getCurrentAuthAccount } from '@/lib/auth'

export default function MixSelectionPage() {
  const router = useRouter()
  const [products, setProducts] = useState<ProductRecord[]>(getAllProducts())
  const [mixSelections, setMixSelections] = useState<MixSelectionList>(createEmptyMixSelections)
  const [authChecked, setAuthChecked] = useState(false)

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

  useEffect(() => {
    const currentAccount = getCurrentAuthAccount()
    if (!currentAccount) {
      router.replace('/auth')
      return
    }

    setMixSelections(readMixSelections())
    setAuthChecked(true)
  }, [router])

  const selectedProducts = useMemo(() => {
    return mixSelections
      .map((selectedSlug) => products.find((product) => product.slug === selectedSlug) || null)
      .filter((product): product is (typeof products)[number] => Boolean(product))
  }, [mixSelections, products])

  const handleToggleSelection = (productSlug: string) => {
    setMixSelections((previousSelections) => {
      const nextSelections = previousSelections.includes(productSlug)
        ? previousSelections.filter((slug) => slug !== productSlug)
        : [...previousSelections, productSlug]

      writeMixSelections(nextSelections)
      return nextSelections
    })
  }

  const handleClearSelections = () => {
    const nextSelections = createEmptyMixSelections()
    setMixSelections(nextSelections)
    writeMixSelections(nextSelections)
  }

  const handleReturnToTryOn = () => {
    writeMixSelections(mixSelections)
    router.push('/?mode=mix')
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-neutral-50" />
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
          <div className="relative border-b border-neutral-200 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.12),_transparent_40%),linear-gradient(135deg,_rgba(255,255,255,1),_rgba(250,250,250,1))] px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="inline-flex rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-700">
                  Mix Selection
                </p>
                <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">自由选择混搭商品</h1>
                <p className="mt-3 text-sm leading-7 text-neutral-600 sm:text-base">
                  这里和商品列表使用同一批商品，但它是单独的混搭选择页。你可以任意勾选商品，不受外套、内搭等种类限制，0 个或多个都可以返回试衣。
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleClearSelections}
                  className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:text-neutral-900"
                >
                  <HiXMark className="h-4 w-4" />
                  清空选择
                </button>
                <button
                  type="button"
                  onClick={handleReturnToTryOn}
                  className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
                >
                  <HiArrowLeft className="h-4 w-4" />
                  返回试衣
                </button>
              </div>
            </div>
          </div>

          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              <p>当前已选 {selectedProducts.length} 个商品。</p>
              <div className="flex flex-wrap gap-2">
                {selectedProducts.length > 0 ? (
                  selectedProducts.map((product) => (
                    <span
                      key={product.slug}
                      className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700"
                    >
                      <HiCheckCircle className="h-4 w-4 text-primary-600" />
                      {product.name}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500">
                    还没有选择商品，点击任意卡片即可添加
                  </span>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {products.map((product) => {
                const isSelected = mixSelections.includes(product.slug)

                return (
                  <button
                    key={product.slug}
                    type="button"
                    onClick={() => handleToggleSelection(product.slug)}
                    className={`overflow-hidden rounded-3xl border text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl ${
                      isSelected ? 'border-primary-500 ring-2 ring-primary-100' : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <div className="relative aspect-[4/5] bg-neutral-100">
                      <img src={product.coverImage} alt={product.name} className="h-full w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-4 text-white">
                        <p className="text-sm font-semibold">{product.name}</p>
                        <p className="mt-1 text-[11px] leading-5 text-white/75">{product.description}</p>
                      </div>
                      <div
                        className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          isSelected ? 'bg-primary-500 text-white shadow' : 'bg-black/60 text-white backdrop-blur-sm'
                        }`}
                      >
                        {isSelected ? '已选中' : '点击添加'}
                      </div>
                      <div className="absolute left-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-700 backdrop-blur-sm">
                        <HiPlus className="mr-1 inline-block h-3 w-3" />
                        自由选择
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600 shadow-sm">
              <p>
                已选 {selectedProducts.length} 个商品，返回试衣页后会自动带入当前选择。
              </p>
              <button
                type="button"
                onClick={handleReturnToTryOn}
                className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
              >
                <HiSparkles className="h-4 w-4" />
                返回试衣
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
