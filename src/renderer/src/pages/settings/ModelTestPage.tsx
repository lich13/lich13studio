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
  type ModelTestTransport,
  type ModelTraceReport,
  runModelTraceTest
} from '@renderer/services/modelTrace/ModelTraceService'
import type { Model } from '@renderer/types'
import { Alert, Button, Card, Input, Select, Space, Tag, Typography } from 'antd'
import { FlaskConical, Play, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '.'

const { TextArea } = Input

const ModelTestPage = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders()
  const { defaultModel } = useDefaultModel()
  const [selectedModel, setSelectedModel] = useState<Model>()
  const [transport, setTransport] = useState<ModelTestTransport>('direct')
  const [challenges, setChallenges] = useState(() => createModelTraceChallenges())
  const [outputs, setOutputs] = useState<ModelTestOutput[]>([])
  const [manualTexts, setManualTexts] = useState<string[]>(['', '', ''])
  const [report, setReport] = useState<ModelTraceReport>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)
  const controllerRef = useRef<AbortController | undefined>(undefined)

  const allModels = useMemo(() => providers.flatMap((provider) => provider.models), [providers])
  const selectedValue = selectedModel ? getModelUniqId(selectedModel) : undefined

  useEffect(() => {
    if (selectedModel && allModels.some((model) => getModelUniqId(model) === getModelUniqId(selectedModel))) return
    setSelectedModel(defaultModel || allModels[0])
  }, [allModels, defaultModel, selectedModel])

  const updateOutput = (index: number, text: string) => {
    setOutputs((current) => {
      const next = [...current]
      next[index] = {
        id: challenges[index]?.id || `challenge-${index + 1}`,
        expected_count: challenges[index]?.expected_count || 0,
        text
      }
      return next
    })
  }

  const startAutomaticTest = async () => {
    if (!selectedModel || running) return
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    setError(undefined)
    setReport(undefined)
    setOutputs([])
    try {
      const result = await runModelTraceTest({
        model: selectedModel,
        transport,
        signal: controller.signal,
        onProgress: ({ index, text }) => updateOutput(index, text)
      })
      setChallenges(result.challenges)
      setOutputs(result.outputs)
      setReport(result.report)
    } catch (testError) {
      if (!controller.signal.aborted) setError(testError instanceof Error ? testError.message : String(testError))
    } finally {
      controllerRef.current = undefined
      setRunning(false)
    }
  }

  const stopAutomaticTest = () => controllerRef.current?.abort()

  const analyzeManual = () => {
    setError(undefined)
    setOutputs(
      manualTexts.map((text, index) => ({
        id: challenges[index]?.id || `challenge-${index + 1}`,
        expected_count: challenges[index]?.expected_count || 0,
        text
      }))
    )
    try {
      setReport(
        analyzeModelTraceOutputs(
          manualTexts.map((text, index) => ({
            id: challenges[index]?.id || `challenge-${index + 1}`,
            expected_count: challenges[index]?.expected_count || 0,
            text
          }))
        )
      )
    } catch (analysisError) {
      setReport(undefined)
      setError(analysisError instanceof Error ? analysisError.message : String(analysisError))
    }
  }

  const regenerateChallenges = () => {
    setChallenges(createModelTraceChallenges())
    setOutputs([])
    setManualTexts(['', '', ''])
    setReport(undefined)
    setError(undefined)
  }

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
          <Select<ModelTestTransport>
            value={transport}
            style={{ width: '100%' }}
            onChange={setTransport}
            options={[
              { value: 'direct', label: t('settings.modelTest.transport.direct') },
              { value: 'iq-proxy', label: t('settings.modelTest.transport.proxy') }
            ]}
          />
          {transport === 'iq-proxy' ? (
            <Alert showIcon type="warning" message={t('settings.modelTest.proxyWarning')} />
          ) : (
            <Alert showIcon type="info" message={t('settings.modelTest.localNotice')} />
          )}
          <Space wrap>
            {running ? (
              <Button danger icon={<Square size={15} />} onClick={stopAutomaticTest}>
                {t('settings.modelTest.stop')}
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<Play size={15} />}
                onClick={() => void startAutomaticTest()}
                disabled={!selectedModel}>
                {t('settings.modelTest.run')}
              </Button>
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
              <TextArea
                rows={5}
                value={outputs[index]?.text || manualTexts[index]}
                onChange={(event) => {
                  const value = event.target.value
                  updateOutput(index, value)
                  setManualTexts((current) => current.map((text, itemIndex) => (itemIndex === index ? value : text)))
                }}
                placeholder={t('settings.modelTest.pastePlaceholder')}
              />
            </Card>
          ))}
          <Button onClick={analyzeManual} disabled={running}>
            {t('settings.modelTest.analyzeManual')}
          </Button>
        </Space>
      </SettingGroup>

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
