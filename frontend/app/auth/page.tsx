'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HiArrowRight, HiCheckCircle, HiUserCircle } from 'react-icons/hi2'

import {
  getCurrentAuthAccount,
  loginAccount,
  registerAccount,
} from '@/lib/auth'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [account, setAccount] = useState('')
  const [message, setMessage] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const currentAccount = getCurrentAuthAccount()
    if (currentAccount) {
      router.replace('/products')
    }
  }, [router])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage('')

    try {
      const result = mode === 'register'
        ? await registerAccount(username, account)
        : await loginAccount(username, account)

      if (!result.ok) {
        setMessage(result.message)
        return
      }

      if (mode === 'register') {
        setMessage('注册成功，请直接登录。')
        setMode('login')
      } else {
        router.replace('/products')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 overflow-hidden rounded-[2rem] border border-neutral-200 bg-white shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative overflow-hidden px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(239,68,68,0.12),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,1),_rgba(250,250,250,1))]" />
            <div className="relative z-10 max-w-xl">
              <p className="inline-flex rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-700">
                AI Try-On Access
              </p>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">先登录，再开始试衣</h1>
              <p className="mt-4 text-sm leading-7 text-neutral-600 sm:text-base">
                注册完成后会回到登录界面，登录成功后跳转到商品列表。
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-neutral-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">流程</p>
                  <p className="mt-2 text-sm font-medium text-neutral-900">注册 → 登录 → 商品列表</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">注册后不会直接进列表，避免误操作。</p>
                </div>
                <div className="rounded-3xl border border-neutral-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">提示</p>
                  <p className="mt-2 text-sm font-medium text-neutral-900">输入正确后即可继续</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">注册和登录都只需要填写用户名和账号。</p>
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-neutral-200 px-6 py-8 sm:px-8 sm:py-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-12">
            <div className="mx-auto max-w-md">
              <div className="mb-6 flex rounded-2xl border border-neutral-200 bg-neutral-50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login')
                    setMessage('')
                  }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    mode === 'login' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register')
                    setMessage('')
                  }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    mode === 'register' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  注册
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">用户名</label>
                  <div className="relative">
                    <HiUserCircle className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-11 py-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-400"
                      placeholder="请输入用户名"
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">账号</label>
                  <input
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-400"
                    placeholder="请输入账号"
                    autoComplete="off"
                  />
                </div>

                {message && (
                  <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <HiCheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{message}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {mode === 'register' ? '注册并返回登录' : '登录并进入商品列表'}
                  <HiArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-6 flex items-center justify-between gap-3 text-sm text-neutral-500">
                <Link href="/" className="transition-colors hover:text-neutral-900">
                  先去试衣页看看
                </Link>
                <span>账号登录</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
