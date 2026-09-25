export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <main>
      <h1>🗺 PoE2 Build Coach 分享服务</h1>
      <p className="sub">链接分享的 API 与落地页。合同与部署见仓库 docs/share-server.md。</p>
      <div className="card">
        <div className="chips">
          <span className="chip">
            <b>POST /api/share</b> 上传码 → 短 id
          </span>
          <span className="chip">
            <b>GET /api/share/:id</b> 取回
          </span>
          <span className="chip">
            <b>GET /api/healthz</b> 探活
          </span>
          <span className="chip">
            <b>GET /s/:id</b> 落地页
          </span>
        </div>
        <p className="steps" style={{ marginTop: 14 }}>
          桌面工具与下载见{' '}
          <a href="https://chenhaolive89.github.io/poe2-build-coach/">PoE2 Build Coach 主站</a>。分享内容由分享者主动上传；码本身不含任何登录凭证。
        </p>
      </div>
    </main>
  )
}
