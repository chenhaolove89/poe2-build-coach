/**
 * /s/:id —— the page a share link opens.
 *
 * The summary and the code come straight from the store (a server component, no
 * HTTP hop and no client-side fetching), so the page works before any hydration
 * and carries no dependencies. Copying is the only interactive bit, split into a
 * client component.
 */
import { notFound } from 'next/navigation'
import { ID_PATTERN } from '@/lib/share'
import { getShare, touchShare } from '@/lib/db'
import CopyButton from './copy-button'

export const dynamic = 'force-dynamic'

const REALM_LABEL: Record<string, string> = { intl: '国际服', cn: '国服', tw: '台服' }

interface Summary {
  realm?: string | null
  league?: string | null
  level?: number | null
  className?: string | null
  ascendClassName?: string | null
  passives?: number
  atlas?: number
  items?: number
  skills?: number
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = ID_PATTERN.test(id) ? await getShare(id) : undefined
  if (!row) notFound()
  const expiresAt = await touchShare(id, Date.now())
  const summary: Summary | null = row.summary ? (JSON.parse(row.summary) as Summary) : null

  const chips: React.ReactNode[] = []
  if (summary) {
    if (summary.realm && REALM_LABEL[summary.realm]) chips.push(<Chip key="realm">服务器: {REALM_LABEL[summary.realm]}</Chip>)
    if (summary.league) chips.push(<Chip key="league">赛季: {summary.league}</Chip>)
    if (summary.className)
      chips.push(
        <Chip key="class">
          职业: {summary.className}
          {summary.ascendClassName ? ` / ${summary.ascendClassName}` : ''}
        </Chip>,
      )
    if (summary.level != null) chips.push(<Chip key="level">等级: {summary.level}</Chip>)
    chips.push(<Chip key="passives">天赋: {summary.passives ?? 0} 点</Chip>)
    chips.push(<Chip key="atlas">异界: {summary.atlas ?? 0} 点</Chip>)
    if (summary.items) chips.push(<Chip key="items">装备: {summary.items} 件</Chip>)
    if (summary.skills) chips.push(<Chip key="skills">技能组: {summary.skills}</Chip>)
  } else {
    chips.push(<Chip key="nosummary">摘要不可用 —— 码本身仍可导入</Chip>)
  }

  return (
    <main>
      <h1>🗺 PoE2 Build Coach 分享</h1>
      <p className="sub">这是一份用 PoE2 Build Coach 制作的配置：服务器与赛季、天赋、异界天赋、装备。把它粘进桌面工具即可还原。</p>
      <div className="card">
        <div className="chips">{chips}</div>
        <p className="k">分享码（也可以直接复制下面这段，粘进工具的导入框）</p>
        <textarea readOnly spellCheck={false} defaultValue={row.code} />
        <CopyButton code={row.code} />
        <p className="meta">链接有效期至 {new Date(expiresAt).toLocaleDateString('zh-CN')}（有人打开就会自动续期）</p>
        <div className="steps">
          <p className="k">如何使用</p>
          <ol>
            <li>
              打开 <a href="https://chenhaolive89.github.io/poe2-build-coach/">PoE2 Build Coach</a>（Windows 桌面工具，纯离线运行）
            </li>
            <li>把上面的分享码粘进主页的导入框，点击解析</li>
            <li>异界点法、装备与技能全部还原，主页会直接给出这张配置的刷图策略卡</li>
          </ol>
        </div>
      </div>
      <p className="foot">分享内容由分享者主动上传；码本身不含任何登录凭证。服务与 Grinding Gear Games 无关。</p>
    </main>
  )
}
