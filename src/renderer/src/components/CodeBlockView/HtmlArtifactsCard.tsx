import { loggerService } from '@logger'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { Button } from 'antd'
import { Code, DownloadIcon, Globe, LinkIcon, Loader2, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const HtmlArtifactsPopup = lazy(() => import('./HtmlArtifactsPopup'))

const logger = loggerService.withContext('HtmlArtifactsCard')

interface Props {
  html: string
  onSave?: (html: string) => void
  isStreaming?: boolean
}

const extractTailPreview = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let pos = trimmed.length
  for (let i = 0; i < 3 && pos > 0; i += 1) {
    const idx = trimmed.lastIndexOf('\n', pos - 1)
    if (idx === -1) return trimmed
    pos = idx
  }
  return trimmed.slice(pos + 1)
}

const HtmlArtifactsCard: FC<Props> = ({ html, onSave, isStreaming = false }) => {
  const { t } = useTranslation()
  const title = extractHtmlTitle(html) || 'HTML Artifacts'
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [hasOpenedPopup, setHasOpenedPopup] = useState(false)

  const htmlContent = html || ''
  const hasContent = htmlContent.trim().length > 0

  const openPopup = () => {
    setHasOpenedPopup(true)
    setIsPopupOpen(true)
  }

  const handleOpenExternal = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, htmlContent)
    const filePath = `file://${path}`

    if (window.api.shell?.openExternal) {
      void window.api.shell.openExternal(filePath)
    } else {
      logger.error(t('chat.artifacts.preview.openExternal.error.content'))
    }
  }

  const handleDownload = async () => {
    const fileName = `${getFileNameFromHtmlTitle(title) || 'html-artifact'}.html`
    await window.api.file.save(fileName, htmlContent)
    window.toast.success(t('message.download.success'))
  }

  return (
    <>
      <Container>
        <Header>
          <IconWrapper>{isStreaming ? <Sparkles size={18} /> : <Globe size={18} />}</IconWrapper>
          <Title title={title}>{title}</Title>
        </Header>
        <Content>
          {isStreaming && !hasContent ? (
            <GeneratingContainer>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
              <GeneratingText>{t('html_artifacts.generating', 'Generating content...')}</GeneratingText>
            </GeneratingContainer>
          ) : isStreaming && hasContent ? (
            <>
              <CodeSnippetPreview>{extractTailPreview(htmlContent)}</CodeSnippetPreview>
              <ButtonContainer>
                <Button icon={<Code size={14} />} onClick={openPopup} type="primary" size="small">
                  {t('chat.artifacts.button.preview')}
                </Button>
              </ButtonContainer>
            </>
          ) : (
            <ButtonContainer>
              <Button icon={<Code size={14} />} onClick={openPopup} type="text" size="small" disabled={!hasContent}>
                {t('chat.artifacts.button.preview')}
              </Button>
              <Button
                icon={<LinkIcon size={14} />}
                onClick={handleOpenExternal}
                type="text"
                size="small"
                disabled={!hasContent}>
                {t('chat.artifacts.button.openExternal')}
              </Button>
              <Button
                icon={<DownloadIcon size={14} />}
                onClick={handleDownload}
                type="text"
                size="small"
                disabled={!hasContent}>
                {t('code_block.download.label')}
              </Button>
            </ButtonContainer>
          )}
        </Content>
      </Container>

      {hasOpenedPopup && (
        <Suspense fallback={null}>
          <HtmlArtifactsPopup
            open={isPopupOpen}
            title={title}
            html={htmlContent}
            onSave={onSave}
            onClose={() => setIsPopupOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

const Container = styled.div`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 0 0 10px;
`

const GeneratingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  min-height: 64px;
`

const GeneratingText = styled.div`
  font-size: 13px;
  color: var(--color-text-secondary);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
`

const IconWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-primary);
`

const Title = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Content = styled.div`
  padding: 0;
  background: var(--color-background);
`

const CodeSnippetPreview = styled.pre`
  margin: 12px 16px 0;
  padding: 10px 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-2);
  font-family: var(--code-font-family);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 88px;
  overflow: hidden;
`

const ButtonContainer = styled.div`
  margin: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

export default HtmlArtifactsCard
