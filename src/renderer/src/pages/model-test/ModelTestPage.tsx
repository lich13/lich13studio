import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useModelTestSession } from '@renderer/hooks/useModelTestSession'
import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '@renderer/pages/settings'
import { modelTestSession } from '@renderer/services/modelTrace/ModelTestSessionService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setModelTestSelection } from '@renderer/store/llm'
import { initialModelTestSelection, resolveModelTestSelection } from '@shared/modelTestSelection'
import { PLATFORM_NAMES, PROVIDER_PLATFORMS, type ProviderPlatform } from '@shared/platforms'
import { Alert, Button, Card, Input, Select, Space, Tag, Typography } from 'antd'
import { ArrowLeft, FlaskConical, Play, Square } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const { TextArea } = Input

const statusKeys = {
  pending: 'settings.modelTest.status.pending',
  running: 'settings.modelTest.status.running',
  retrying: 'settings.modelTest.status.retrying',
  valid: 'settings.modelTest.status.valid',
  invalid: 'settings.modelTest.status.invalid',
  error: 'settings.modelTest.status.error',
  aborted: 'settings.modelTest.status.aborted'
} as const
const issueKeys = {
  empty: 'settings.modelTest.issue.empty',
  'reasoning-tag': 'settings.modelTest.issue.reasoning-tag',
  format: 'settings.modelTest.issue.format',
  range: 'settings.modelTest.issue.range',
  count: 'settings.modelTest.issue.count',
  incomplete: 'settings.modelTest.issue.incomplete'
} as const

const ModelTestPage = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const llm = useAppSelector((state) => state.llm)
  const selection = useMemo(() => llm.modelTestSelection ?? initialModelTestSelection(llm), [llm])
  const resolved = resolveModelTestSelection(selection, llm)
  const { challenges, outputs, report, error, phase, target, canRetry } = useModelTestSession()
  const running = phase === 'running'

  useEffect(() => {
    if (llm.modelTestSelection === undefined) dispatch(setModelTestSelection(selection))
  }, [dispatch, llm.modelTestSelection, selection])

  const modelOptions = PROVIDER_PLATFORMS.map((platform) => ({
    label: PLATFORM_NAMES[platform],
    options: llm.platformModels[platform].map((model) => ({
      value: JSON.stringify([platform, model.id]),
      label: model.id === model.name ? model.id : `${model.name} · ${model.id}`,
      disabled: false
    }))
  }))
  if (selection.modelId && !llm.platformModels[selection.platform!]?.some((model) => model.id === selection.modelId)) {
    modelOptions.push({
      label: t('settings.modelTest.unavailable'),
      options: [
        {
          value: JSON.stringify([selection.platform, selection.modelId]),
          label: selection.modelId,
          disabled: true
        }
      ]
    })
  }
  const providerOptions = resolved.providers.map((provider) => ({
    value: provider.id,
    label: provider.name,
    disabled: false
  }))
  if (selection.providerId && !resolved.provider)
    providerOptions.push({
      value: selection.providerId,
      label: `${llm.providers.find((provider) => provider.id === selection.providerId)?.name || selection.providerId} (${t('settings.modelTest.unavailable')})`,
      disabled: true
    })

  return (
    <Page>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.modelTest.title')}</NavbarCenter>
      </Navbar>
      <SettingContainer theme={theme}>
        <SettingGroup theme={theme}>
          <SettingTitle>
            <HStack alignItems="center" gap={10}>
              <FlaskConical size={18} />
              {t('settings.modelTest.title')}
            </HStack>
            <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => navigate('/')}>
              {t('settings.modelTest.backHome')}
            </Button>
          </SettingTitle>
          <SettingDescription>{t('settings.modelTest.description')}</SettingDescription>
          <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="middle">
            <Space wrap style={{ width: '100%' }}>
              <div>
                <Typography.Text>{t('settings.modelTest.modelLabel')}</Typography.Text>
                <Select
                  aria-label={t('settings.modelTest.modelLabel')}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 300, display: 'block', marginTop: 6 }}
                  value={
                    selection.platform && selection.modelId
                      ? JSON.stringify([selection.platform, selection.modelId])
                      : undefined
                  }
                  options={modelOptions}
                  placeholder={t('button.select_model')}
                  onChange={(value: string) => {
                    const [platform, modelId] = JSON.parse(value) as [ProviderPlatform, string]
                    dispatch(setModelTestSelection({ platform, modelId }))
                  }}
                />
              </div>
              <div>
                <Typography.Text>{t('settings.modelTest.providerLabel')}</Typography.Text>
                <Select
                  aria-label={t('settings.modelTest.providerLabel')}
                  style={{ width: 260, display: 'block', marginTop: 6 }}
                  value={selection.providerId}
                  options={providerOptions}
                  placeholder={t('settings.modelTest.providerPlaceholder')}
                  onChange={(providerId: string) => dispatch(setModelTestSelection({ providerId }))}
                />
              </div>
            </Space>
            {resolved.issue && (
              <Alert
                type="warning"
                showIcon
                message={
                  resolved.issue === 'modelUnavailable'
                    ? t('settings.modelTest.modelUnavailable')
                    : t('settings.modelTest.providerUnavailable')
                }
              />
            )}
            <Alert showIcon type="info" message={t('settings.modelTest.localNotice')} />
            <Typography.Text type="secondary">{t('settings.modelTest.backgroundNotice')}</Typography.Text>
            {running && <Typography.Text>{t('settings.modelTest.nextSelection')}</Typography.Text>}
            {target && (
              <Typography.Text strong>
                {t('settings.modelTest.runTarget', { provider: target.providerName, model: target.modelId })}
              </Typography.Text>
            )}
            {phase === 'completed' && (
              <Typography.Text type="secondary">{t('settings.modelTest.completed')}</Typography.Text>
            )}
            <Space wrap>
              {running ? (
                <Button danger icon={<Square size={15} />} onClick={() => modelTestSession.stop()}>
                  {t('settings.modelTest.stop')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<Play size={15} />}
                  onClick={() => resolved.model && void modelTestSession.start(resolved.model)}
                  disabled={!resolved.model}>
                  {t('settings.modelTest.run')}
                </Button>
              )}
              {canRetry && (
                <Button onClick={() => void modelTestSession.retryFailed()}>
                  {t('settings.modelTest.retryFailed')}
                </Button>
              )}
              <Button onClick={() => modelTestSession.regenerate()} disabled={running}>
                {t('settings.modelTest.regenerate')}
              </Button>
            </Space>
          </Space>
        </SettingGroup>

        {error && <Alert showIcon type="error" message={error} style={{ marginBottom: 16 }} />}

        <SettingGroup theme={theme}>
          <SettingTitle>{t('settings.modelTest.challenges')}</SettingTitle>
          <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size="middle">
            {challenges.map((challenge, index) => (
              <Card
                key={challenge.id}
                size="small"
                title={t('settings.modelTest.challenge', { index: index + 1, count: challenge.expected_count })}>
                <Typography.Paragraph copyable={{ text: challenge.prompt }} style={{ whiteSpace: 'pre-wrap' }}>
                  {challenge.prompt}
                </Typography.Paragraph>
                <Space wrap style={{ marginBottom: 8 }}>
                  <Tag color={outputs[index]?.status === 'valid' ? 'success' : undefined}>
                    {t(statusKeys[outputs[index]?.status || 'pending'])}
                  </Tag>
                  <Typography.Text type="secondary">
                    {t('settings.modelTest.attempts', { count: outputs[index]?.attempts || 0, max: 3 })}
                    {' · '}
                    {t('settings.modelTest.count', {
                      actual: outputs[index]?.parsedCount || 0,
                      expected: challenge.expected_count
                    })}
                  </Typography.Text>
                </Space>
                {(outputs[index]?.issue || outputs[index]?.error) && (
                  <Alert
                    showIcon
                    type="warning"
                    style={{ marginBottom: 8 }}
                    message={outputs[index]?.error || t(issueKeys[outputs[index]?.issue || 'incomplete'])}
                  />
                )}
                <TextArea
                  rows={5}
                  value={outputs[index]?.text || ''}
                  readOnly={running}
                  onChange={(event) => modelTestSession.editOutput(index, event.target.value)}
                  placeholder={t('settings.modelTest.pastePlaceholder')}
                />
              </Card>
            ))}
            <Button onClick={() => modelTestSession.analyze()} disabled={running}>
              {t('settings.modelTest.analyzeManual')}
            </Button>
          </Space>
        </SettingGroup>

        {!running && outputs.length > 0 && !report && (
          <Alert showIcon type="info" message={t('settings.modelTest.incomplete')} style={{ marginBottom: 16 }} />
        )}
        {report && (
          <SettingGroup theme={theme}>
            <SettingTitle>{t('settings.modelTest.result')}</SettingTitle>
            <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}>
              <Typography.Text strong>
                {report.prediction_name} · {(report.probability * 100).toFixed(1)}%
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('settings.modelTest.familyResult', {
                  family: report.family_prediction_name,
                  probability: (report.family_probability * 100).toFixed(1)
                })}
              </Typography.Text>
              <Space wrap>
                {report.results.slice(0, 6).map((item) => (
                  <Tag key={String(item.model)}>
                    {String(item.display_name)} {(Number(item.probability) * 100).toFixed(1)}%
                  </Tag>
                ))}
              </Space>
              <Typography.Text type="secondary">
                {t('settings.modelTest.usedOutputs', { count: report.used_outputs })}
              </Typography.Text>
            </Space>
          </SettingGroup>
        )}
      </SettingContainer>
    </Page>
  )
}

const Page = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: var(--app-viewport-height);
  overflow: hidden;
`

export default ModelTestPage
