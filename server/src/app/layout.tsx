import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'PoE2 Build Coach — 分享服务',
  robots: { index: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  )
}
