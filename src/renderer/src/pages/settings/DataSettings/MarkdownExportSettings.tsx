import { useTheme } from '@renderer/context/ThemeProvider'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import {
  setExcludeCitationsInExport,
  setForceDollarMathInMarkdown,
  setShowModelNameInMarkdown,
  setShowModelProviderInMarkdown,
  setStandardizeCitationsInExport,
  setUseTopicNamingForMessageTitle
} from '@renderer/store/settings'
import { Switch } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const MarkdownExportSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const forceDollarMathInMarkdown = useSelector((state: RootState) => state.settings.forceDollarMathInMarkdown)
  const useTopicNamingForMessageTitle = useSelector((state: RootState) => state.settings.useTopicNamingForMessageTitle)
  const showModelNameInExport = useSelector((state: RootState) => state.settings.showModelNameInMarkdown)
  const showModelProviderInMarkdown = useSelector((state: RootState) => state.settings.showModelProviderInMarkdown)
  const excludeCitationsInExport = useSelector((state: RootState) => state.settings.excludeCitationsInExport)
  const standardizeCitationsInExport = useSelector((state: RootState) => state.settings.standardizeCitationsInExport)

  const handleToggleForceDollarMath = (checked: boolean) => {
    dispatch(setForceDollarMathInMarkdown(checked))
  }

  const handleToggleTopicNaming = (checked: boolean) => {
    dispatch(setUseTopicNamingForMessageTitle(checked))
  }

  const handleToggleShowModelName = (checked: boolean) => {
    dispatch(setShowModelNameInMarkdown(checked))
  }

  const handleToggleShowModelProvider = (checked: boolean) => {
    dispatch(setShowModelProviderInMarkdown(checked))
  }

  const handleToggleExcludeCitations = (checked: boolean) => {
    dispatch(setExcludeCitationsInExport(checked))
  }

  const handleToggleStandardizeCitations = (checked: boolean) => {
    dispatch(setStandardizeCitationsInExport(checked))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.markdown_export.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.force_dollar_math.title')}</SettingRowTitle>
        <Switch checked={forceDollarMathInMarkdown} onChange={handleToggleForceDollarMath} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.force_dollar_math.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.message_title.use_topic_naming.title')}</SettingRowTitle>
        <Switch checked={useTopicNamingForMessageTitle} onChange={handleToggleTopicNaming} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.message_title.use_topic_naming.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_name.title')}</SettingRowTitle>
        <Switch checked={showModelNameInExport} onChange={handleToggleShowModelName} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_name.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_provider.title')}</SettingRowTitle>
        <Switch checked={showModelProviderInMarkdown} onChange={handleToggleShowModelProvider} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_provider.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.exclude_citations.title')}</SettingRowTitle>
        <Switch checked={excludeCitationsInExport} onChange={handleToggleExcludeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.exclude_citations.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.standardize_citations.title')}</SettingRowTitle>
        <Switch checked={standardizeCitationsInExport} onChange={handleToggleStandardizeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.standardize_citations.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default MarkdownExportSettings
