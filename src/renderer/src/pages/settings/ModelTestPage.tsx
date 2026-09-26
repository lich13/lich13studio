import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import {
  analyzeModelTraceOutputs,
  createModelTraceChallenges,
  type ModelTestOutput,
  ModelTestRunner,
  type ModelTestTarget,
  type ModelTraceReport
} from '@renderer/services/modelTrace/ModelTraceService'
import { validateModelTraceOutput } from '@renderer/services/modelTrace/outputValidation'
import type { Model } from '@renderer/types'
import { Alert, Button, Card, Input, Space, Tag, Typography } from 'antd'
import { FlaskConical, Play, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '.'

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
  const { providers } = useProviders()
  const { defaultModel } = useDefaultModel()
  const [selectedModel, setSelectedModel] = useState<Model>()
  const [challenges, setChallenges] = useState(() => createModelTraceChallenges())
  const [outputs, setOutputs] = useState<ModelTestOutput[]>([])
  const [report, setReport] = useState<ModelTraceReport>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)
  const [target, setTarget] = useState<ModelTestTarget>()
  const runnerRef = useRef<ModelTestRunner | undefined>(undefined)
  const generationRef = useRef(0)

  const allModels = useMemo(() => providers.flatMap((provider) => provider.models), [providers])
  const selectedValue = selectedModel ? getModelUniqId(selectedModel) : undefined

  useEffect(() => {
    if (selectedModel && allModels.some((model) => getModelUniqId(model) === getModelUniqId(selectedModel))) return
    setSelectedModel(defaultModel || allModels[0])
  }, [allModels, defaultModel, selectedModel])

  useEffect(() => {
    generationRef.current += 1
    const previous = runnerRef.current
    runnerRef.current = undefined
    previous?.cancel()
    setRunning(false)
    setOutputs([])
    setTarget(undefined)
    setReport(undefined)
    setError(undefined)
    return () => {
      generationRef.current += 1
      const previous = runnerRef.current
      runnerRef.current = undefined
      previous?.cancel()
    }
  }, [selectedValue])

  const startAutomaticTest = async (retryFailedOnly = false) => {
    if (!selectedModel || running) return
    const generation = ++generationRef.current
    if (!retryFailedOnly || !runnerRef.current) {
      runnerRef.current?.cancel()
      runnerRef.current = new ModelTestRunner({
        model: selectedModel,
        challenges,
        onProgress: ({ index, output, target: runTarget }) => {
          if (runnerRef.current !== runner) return
          setTarget(runTarget)
          setOutputs((current) => {
            const next = [...current]
            next[index] = output
            return next
          })
        }
      })
      setOutputs([])
    }
    const runner = runnerRef.current
    setRunning(true)
    setError(undefined)
    setReport(undefined)
    try {
      const result = await runner.run({ retryFailedOnly })
      if (generationRef.current !== generation) return
      setTarget(result.target)
      setOutputs(result.outputs)
      setReport(result.report)
      setError(result.error)
    } catch (testError) {
      if (generationRef.current === generation)
        setError(testError instanceof Error ? testError.message : String(testError))
    } finally {
      if (generationRef.current === generation) setRunning(false)
    }
  }

  const stopAutomaticTest = () => {
    generationRef.current += 1
    runnerRef.current?.cancel()
    setRunning(false)
    setReport(undefined)
  }

  const editOutput = (index: number, text: string) => {
    // Edited results must never reuse automatic successes or an old report.
    runnerRef.current = undefined
    setReport(undefined)
    setError(undefined)
    setOutputs((current) => {
      const next = [...current]
      next[index] = { id: challenges[index].id, expected_count: challenges[index].expected_count, text }
      return next
    })
  }

  const analyzeManual = () => {
    const checked = challenges.map((challenge, index): ModelTestOutput => {
      const text = outputs[index]?.text || ''
      const validation = validateModelTraceOutput(text, challenge.expected_count)
      return {
        id: challenge.id,
        expected_count: challenge.expected_count,
        text: validation.text,
        status: validation.accepted ? 'valid' : 'invalid',
        parsedCount: validation.parsedCount,
        issue: validation.issue
      }
    })
    setOutputs(checked)
    setReport(undefined)
    setError(undefined)
    if (checked.every((output) => output.status === 'valid')) setReport(analyzeModelTraceOutputs(checked))
    else setError(t('settings.modelTest.incomplete'))
  }

  const regenerateChallenges = () => {
    runnerRef.current = undefined
    setChallenges(createModelTraceChallenges())
    setOutputs([])
    setTarget(undefined)
    setReport(undefined)
    setError(undefined)
  }

  const canRetry = !running && !!runnerRef.current && outputs.some((output) => output.status !== 'valid')

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          <HStack alignItems="center" gap={10}>
            <FlaskConical size={18} />
            {t('settings.modelTest.title')}
          </HStack>
        </SettingTitle>
        <SettingDescription>{t('settings.modelTest.description')}</SettingDescription>
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="middle">
          <ModelSelector
            providers={providers}
            value={selectedValue}
            defaultValue={selectedValue}
            onChange={(value) => setSelectedModel(allModels.find((model) => getModelUniqId(model) === value))}
            placeholder={t('settings.models.empty')}
          />
          <Alert showIcon type="info" message={t('settings.modelTest.localNotice')} />
          <Typography.Text type="secondary">
            {t('settings.modelTest.target', {
              provider:
                target?.providerName ||
                providers.find((provider) => provider.id === selectedModel?.provider)?.name ||
                '—',
              model: target?.modelId || selectedModel?.id || '—'
            })}
          </Typography.Text>
          <Space wrap>
            {running ? (
              <Button danger icon={<Square size={15} />} onClick={stopAutomaticTest}>
                {t('settings.modelTest.stop')}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<Play size={15} />}
                onClick={() => void startAutomaticTest(false)}
                disabled={!selectedModel}>
                {t('settings.modelTest.run')}
              </Button>
            )}
            {canRetry && (
              <Button onClick={() => void startAutomaticTest(true)}>{t('settings.modelTest.retryFailed')}</Button>
            )}
            <Button onClick={regenerateChallenges} disabled={running}>
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
                onChange={(event) => editOutput(index, event.target.value)}
                placeholder={t('settings.modelTest.pastePlaceholder')}
              />
            </Card>
          ))}
          <Button onClick={analyzeManual} disabled={running}>
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
  )
}

export default ModelTestPage
