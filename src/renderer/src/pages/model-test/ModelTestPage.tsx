import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import ModelProviderSelect from '@renderer/components/ModelProviderSelect'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useModelTestSession } from '@renderer/hooks/useModelTestSession'
import { SettingContainer, SettingGroup, SettingTitle } from '@renderer/pages/settings'
import { fingerprintBankService } from '@renderer/services/modelTrace/FingerprintBankService'
import { modelTestSession } from '@renderer/services/modelTrace/ModelTestSessionService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setModelTestConcurrency, setModelTestSelection } from '@renderer/store/llm'
import { normalizeModelTestConcurrency } from '@shared/modelTestOptions'
import { initialModelTestSelection, resolveModelTestSelection } from '@shared/modelTestSelection'
import { Alert, Button, Card, Input, Segmented, Space, Tag, Typography } from 'antd'
import { ArrowLeft, FlaskConical, Play, Square } from 'lucide-react'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import ModelTestViewBoundary from './ModelTestViewBoundary'

const { TextArea } = Input

const statusKeys = {
  pending: 'settings.modelTest.status.pending',
  running: 'settings.modelTest.status.running',
  retrying: 'settings.modelTest.status.retrying',
  completed: 'settings.modelTest.status.completed',
  error: 'settings.modelTest.status.error',
  aborted: 'settings.modelTest.status.aborted'
} as const
const issueKeys = {
  empty: 'settings.modelTest.issue.empty',
  'reasoning-tag': 'settings.modelTest.issue.reasoning-tag',
  format: 'settings.modelTest.issue.format',
  insufficient: 'settings.modelTest.issue.insufficient'
} as const
const retryStopKeys = {
  exhausted: 'settings.modelTest.retryStop.exhausted',
  cancelled: 'settings.modelTest.retryStop.cancelled',
  auth: 'settings.modelTest.retryStop.auth',
  quota: 'settings.modelTest.retryStop.quota',
  model: 'settings.modelTest.retryStop.model',
  'invalid-request': 'settings.modelTest.retryStop.invalidRequest'
} as const
const bankErrorKeys = {
  network: 'settings.modelTest.bankError.network',
  cache: 'settings.modelTest.bankError.cache',
  'invalid-data': 'settings.modelTest.bankError.invalid-data',
  incompatible: 'settings.modelTest.bankError.incompatible'
} as const

const ModelTestPage = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const llm = useAppSelector((state) => state.llm)
  const selection = useMemo(() => llm.modelTestSelection ?? initialModelTestSelection(llm), [llm])
  const resolved = resolveModelTestSelection(selection, llm)
  const canStart = resolved.model && !isEmbeddingModel(resolved.model) && !isRerankModel(resolved.model)
  const { challenges, outputs, report, error, phase, target, canRetry, bankVersion } = useModelTestSession()
  const bankState = useSyncExternalStore(fingerprintBankService.subscribe, fingerprintBankService.getSnapshot)
  const shownBankVersion = bankVersion ?? bankState.active.version
  const concurrency = normalizeModelTestConcurrency(llm.modelTestConcurrency)
  const running = phase === 'running'

  useEffect(() => {
    if (llm.modelTestSelection === undefined) dispatch(setModelTestSelection(selection))
  }, [dispatch, llm.modelTestSelection, selection])

  return (
    <Page>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.modelTest.title')}</NavbarCenter>
      </Navbar>
      <TestContainer theme={theme}>
        <TopRow>
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
            <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="middle">
              <ModelProviderSelect selection={selection} onChange={(next) => dispatch(setModelTestSelection(next))} />
              <Space wrap>
                <span id="model-test-concurrency">{t('settings.modelTest.concurrency')}</span>
                <Segmented
                  aria-labelledby="model-test-concurrency"
                  options={[1, 2, 3]}
                  value={concurrency}
                  disabled={running}
                  onChange={(value) => dispatch(setModelTestConcurrency(normalizeModelTestConcurrency(value)))}
                />
              </Space>
              <Space wrap>
                <Typography.Link
                  href={`https://github.com/Hanmo123/ModelTrace/tree/${shownBankVersion.revision}`}
                  target="_blank"
                  rel="noreferrer"
                  title={shownBankVersion.sha256}>
                  {t('settings.modelTest.bank')} {shownBankVersion.revision.slice(0, 8)}
                </Typography.Link>
                <Button
                  size="small"
                  loading={bankState.status === 'checking'}
                  title={
                    bankState.checkedAt
                      ? t('settings.modelTest.checkedAt', { time: new Date(bankState.checkedAt).toLocaleString() })
                      : undefined
                  }
                  onClick={() => void fingerprintBankService.sync(true)}>
                  {t('settings.modelTest.checkBank')}
                </Button>
              </Space>
              {bankState.error && <Alert showIcon type="warning" message={t(bankErrorKeys[bankState.error])} />}
              {target && (
                <Typography.Text strong>
                  {t('settings.modelTest.runTarget', { provider: target.providerName, model: target.modelId })}
                </Typography.Text>
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
                    onClick={() =>
                      canStart && resolved.model && void modelTestSession.start(resolved.model, concurrency)
                    }
                    disabled={!canStart}>
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

          <SettingGroup theme={theme} aria-label={t('settings.modelTest.result')}>
            <SettingTitle>{t('settings.modelTest.result')}</SettingTitle>
            {running && report && <Tag style={{ marginTop: 12 }}>{t('settings.modelTest.resultRunning')}</Tag>}
            {report ? (
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
            ) : (
              <ResultPlaceholder>
                {running
                  ? t('settings.modelTest.resultRunning')
                  : phase === 'completed'
                    ? t('settings.modelTest.noSamples')
                    : phase === 'idle'
                      ? t('settings.modelTest.resultPending')
                      : t('settings.modelTest.noUsableSamples')}
              </ResultPlaceholder>
            )}
          </SettingGroup>
        </TopRow>

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
                  <Tag color={outputs[index]?.status === 'completed' ? 'success' : undefined}>
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
                {(outputs[index]?.retryDelayMs || outputs[index]?.retryStopReason) && (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    {outputs[index]?.status === 'retrying'
                      ? t('settings.modelTest.retryWaiting', { seconds: outputs[index]!.retryDelayMs! / 1000 })
                      : outputs[index]?.retryStopReason && t(retryStopKeys[outputs[index]!.retryStopReason!])}
                  </Typography.Paragraph>
                )}
                {outputs[index]?.status === 'completed' && (
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    {t('settings.modelTest.samples', {
                      usable: outputs[index]?.usableCount || 0,
                      excluded: outputs[index]?.excludedCount || 0
                    })}
                    {outputs[index]?.issue && ` · ${t(issueKeys[outputs[index]!.issue!])}`}
                  </Typography.Paragraph>
                )}
                {outputs[index]?.error && (
                  <Alert
                    showIcon
                    type="warning"
                    style={{ marginBottom: 8 }}
                    message={
                      outputs[index]?.failureCode === 'output-limit'
                        ? t('settings.modelTest.outputLimit', {
                            actual: outputs[index]?.limit?.actual,
                            maximum: outputs[index]?.limit?.maximum,
                            unit: t(
                              outputs[index]?.limit?.kind === 'integers'
                                ? 'settings.modelTest.integerUnit'
                                : 'settings.modelTest.byteUnit'
                            )
                          })
                        : outputs[index]?.error
                    }
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
      </TestContainer>
    </Page>
  )
}

const TestContainer = styled(SettingContainer)`
  container: model-test / inline-size;
`

const TopRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  margin-bottom: 20px;

  > div {
    min-width: 0;
    margin-bottom: 0;
  }

  @container model-test (min-width: 960px) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
`

const ResultPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  color: var(--color-text-3);
`

const Page = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: var(--app-viewport-height);
  overflow: hidden;
`

export default function ModelTestPageWithRecovery() {
  return (
    <ModelTestViewBoundary>
      <ModelTestPage />
    </ModelTestViewBoundary>
  )
}
