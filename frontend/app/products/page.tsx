'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HiArrowRight, HiCheckCircle, HiSparkles, HiShoppingCart, HiTrash, HiXMark } from 'react-icons/hi2'

import {
  GARMENT_PART_LABELS,
  getAllProducts,
  loadCatalogProducts,
  type ProductRecord,
} from '@/lib/products'
import { clearCartItems, readCartItems, removeCartItem, type CartItem } from '@/lib/cart'
import { writeCartItems } from '@/lib/cart'
import { clearAuthSession, getCurrentAuthAccount } from '@/lib/auth'
import { readFavoriteProductSlugs, removeFavoriteProductSlug, writeFavoriteProductSlugs } from '@/lib/favorites'

export default function ProductsPage() {
  const router = useRouter()
  const [products, setProducts] = useState<ProductRecord[]>(getAllProducts())
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [selectedCartIds, setSelectedCartIds] = useState<string[]>([])
  const [paymentSuccessOpen, setPaymentSuccessOpen] = useState(false)
  const [paymentSummary, setPaymentSummary] = useState<string>('')
  const [authUser, setAuthUser] = useState<{ username: string; account: string } | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [favoriteProductSlugs, setFavoriteProductSlugs] = useState<string[]>([])
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const currentAccount = getCurrentAuthAccount()
    if (!currentAccount) {
      router.replace('/auth')
      return
    }

    setAuthUser(currentAccount)
    setAuthChecked(true)
  }, [router])

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
    const items = readCartItems()
    setCartItems(items)
    setSelectedCartIds(items.map((item) => item.id))
  }, [])

  useEffect(() => {
    setFavoriteProductSlugs(readFavoriteProductSlugs())
  }, [])

  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
    }
  }, [])

  const handleLogout = () => {
    clearAuthSession()
    router.push('/auth')
  }

  const selectedItems = useMemo(
    () => cartItems.filter((item) => selectedCartIds.includes(item.id)),
    [cartItems, selectedCartIds]
  )

  const favoriteProducts = useMemo(
    () =>
      favoriteProductSlugs
        .map((selectedSlug) => products.find((product) => product.slug === selectedSlug) || null)
        .filter((product): product is (typeof products)[number] => Boolean(product)),
    [favoriteProductSlugs, products]
  )

  const syncCartState = (items: CartItem[]) => {
    setCartItems(items)
    setSelectedCartIds((previousSelectedIds) => previousSelectedIds.filter((id) => items.some((item) => item.id === id)))
  }

  const handleRemoveItem = (itemId: string) => {
    const nextItems = removeCartItem(itemId)
    syncCartState(nextItems)
  }

  const handleToggleItem = (itemId: string) => {
    setSelectedCartIds((previousSelectedIds) =>
      previousSelectedIds.includes(itemId)
        ? previousSelectedIds.filter((id) => id !== itemId)
        : [...previousSelectedIds, itemId]
    )
  }

  const handleRemoveFavoriteProduct = (slug: string) => {
    setFavoriteProductSlugs((previousSlugs) => {
      const nextSlugs = removeFavoriteProductSlug(previousSlugs, slug)
      writeFavoriteProductSlugs(nextSlugs)
      return nextSlugs
    })
  }

  const closePaymentSuccess = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }

    setPaymentSuccessOpen(false)
    setPaymentSummary('')
  }

  const handleCheckout = () => {
    if (selectedItems.length === 0) {
      setPaymentSummary('请先勾选要支付的商品。')
      setPaymentSuccessOpen(true)
      return
    }

    const summaryText = `已支付 ${selectedItems.length} 件商品：${selectedItems.map((item) => `${item.productName}-${item.skuName}`).join('、')}`
    setPaymentSummary(summaryText)
    setPaymentSuccessOpen(true)

    const remainingItems = cartItems.filter((item) => !selectedCartIds.includes(item.id))
    clearCartItems()
    if (remainingItems.length > 0) {
      // Re-store remaining items after the checkout success is shown.
      // The cart itself is only local storage, so this keeps the unselected items.
      writeCartItems(remainingItems)
    }

    setCartItems(remainingItems)
    setSelectedCartIds(remainingItems.map((item) => item.id))

    autoCloseTimerRef.current = setTimeout(() => {
      closePaymentSuccess()
    }, 3000)
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-neutral-50" />
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div id="cart" className="mb-8 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-lg scroll-mt-8">
          <div className="grid gap-0 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="relative p-6 sm:p-8 lg:p-12">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.08),_transparent_40%),linear-gradient(135deg,_rgba(250,250,250,1),_rgba(255,255,255,1))]" />
              <div className="relative z-10 max-w-2xl">
                <p className="mb-3 inline-flex rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary-700">
                  数据库商品
                </p>
                <h1 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  先选商品，再进入 AI 试衣
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-neutral-600 sm:text-base">
                  在这里浏览全部商品，进入详情页后可查看不同款式，并一键开始 AI 试衣。
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
                  >
                    进入试衣界面
                    <HiArrowRight className="h-4 w-4" />
                  </Link>
                  <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-medium text-neutral-700 shadow-sm">
                    <HiSparkles className="h-4 w-4 text-primary-500" />
                    共 {products.length} 个商品
                  </span>
                  {authUser && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-5 py-3 text-sm font-medium text-primary-700 shadow-sm">
                      已登录：{authUser.username}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:text-neutral-900"
                  >
                    退出登录
                  </button>
                </div>

                <div className="mt-6 max-w-2xl rounded-3xl border border-neutral-200 bg-white/90 p-4 shadow-xl backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                        <HiShoppingCart className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">购物车</p>
                        <p className="text-xs text-neutral-500">勾选后点击支付即可显示成功提示</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
                        {selectedItems.length} / {cartItems.length}
                      </span>
                      <button
                        type="button"
                        onClick={handleCheckout}
                        disabled={selectedItems.length === 0}
                        className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
                        style={selectedItems.length === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                      >
                        支付
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[220px] overflow-y-auto pt-4">
                    {cartItems.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {cartItems.map((item) => {
                          const isSelected = selectedCartIds.includes(item.id)

                          return (
                            <div
                              key={item.id}
                              className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                                isSelected ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white'
                              }`}
                            >
                              <label className="flex flex-1 cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleItem(item.id)}
                                  className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                />
                                <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-neutral-100">
                                  <img src={item.imageSrc} alt={item.imageAlt} className="h-full w-full object-cover" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-neutral-900">{item.productName}</p>
                                  <p className="truncate text-xs text-neutral-500">{item.skuName}</p>
                                </div>
                              </label>
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(item.id)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition-colors hover:border-red-200 hover:text-red-600"
                                aria-label="Remove item"
                              >
                                <HiTrash className="h-4 w-4" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
                        <div>
                          <p className="text-sm font-medium text-neutral-700">购物车还是空的</p>
                          <p className="mt-1 text-xs text-neutral-500">去商品详情页或试衣页挑选喜欢的款式吧。</p>
                        </div>
                      </div>
                    )}
                    {cartItems.length > 0 && selectedItems.length === 0 && (
                      <p className="mt-3 px-1 text-xs text-neutral-500">请先勾选至少一个商品再支付。</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {products.length > 0 && (
              <div className="hidden min-h-[240px] bg-[linear-gradient(180deg,_rgba(17,17,17,0.95),_rgba(39,39,42,0.9))] p-8 lg:block">
                <div className="mb-3 flex items-center justify-end text-white/85">
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">共 {products.length} 件</span>
                </div>
                <div className="grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                  {products.map((product) => (
                    <div key={product.slug} className="group relative overflow-hidden rounded-2xl bg-white/10 shadow-xl ring-1 ring-white/10">
                      <div className="aspect-[4/5]">
                        <img src={product.coverImage} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
                        <p className="truncate text-xs font-medium text-white">{product.name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="mb-8 rounded-3xl border border-neutral-200 bg-white p-6 shadow-lg sm:p-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">收藏夹</h2>
              <p className="mt-1 text-sm text-neutral-500">收藏过的商品会显示在这里，方便快速回到详情页或试衣页。</p>
            </div>
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">{favoriteProducts.length} 件</span>
          </div>

          {favoriteProducts.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {favoriteProducts.map((product) => (
                <div key={product.slug} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                  <div className="relative aspect-[4/5] bg-neutral-100">
                    <img src={product.coverImage} alt={product.name} className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-white">
                      <p className="text-sm font-semibold">{product.name}</p>
                      <p className="mt-1 text-[11px] leading-4 text-white/80">{product.subtitle}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <Link
                      href={`/products/${product.slug}`}
                      className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-primary-200 hover:text-primary-700"
                    >
                      查看详情
                    </Link>
                    <Link
                      href={`/?product=${encodeURIComponent(product.slug)}`}
                      className="rounded-full bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
                    >
                      去试衣
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveFavoriteProduct(product.slug)}
                      className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-900"
                    >
                      取消收藏
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-neutral-700">还没有收藏商品</p>
              <p className="mt-1 text-xs text-neutral-500">去详情页点一下收藏，商品就会出现在这里。</p>
            </div>
          )}
        </section>

        <section>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">商品列表</h2>
              <p className="mt-1 text-sm text-neutral-500">点击任意商品进入详情页，查看更多款式与搭配效果。</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {products.map((product) => (
              <Link
                key={product.slug}
                href={`/products/${product.slug}`}
                className="group overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                  <img
                    src={product.coverImage}
                    alt={product.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-4 text-white">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">
                        {GARMENT_PART_LABELS[product.part]}
                      </span>
                      <p className="text-xs uppercase tracking-[0.2em] text-white/70">可选商品种类 {product.skus.length}</p>
                    </div>
                    <h3 className="mt-1 text-lg font-semibold">{product.name}</h3>
                  </div>
                </div>
                <div className="space-y-3 p-5">
                  <p className="line-clamp-2 text-sm leading-6 text-neutral-600">{product.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">
                      查看详情
                    </span>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white transition-transform group-hover:translate-x-1">
                      <HiArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {paymentSuccessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={closePaymentSuccess}
              className="absolute right-4 top-4 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              aria-label="Close payment success"
            >
              <HiXMark className="h-5 w-5" />
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <HiCheckCircle className="h-9 w-9" />
              </div>
              <h3 className="mt-4 text-2xl font-bold text-neutral-900">支付成功</h3>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{paymentSummary}</p>
              <p className="mt-2 text-xs text-neutral-400">弹窗会在 3 秒后自动关闭，也可以手动关闭。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
