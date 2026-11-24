import type { Message, Topic } from '@renderer/types'
import i18next from 'i18next'

export const copyTopicAsMarkdown = async (topic: Topic) => {
  const { topicToMarkdown } = await import('./export')
  const markdown = await topicToMarkdown(topic)
  await navigator.clipboard.writeText(markdown)
  window.toast.success(i18next.t('message.copy.success'))
}

export const copyTopicAsPlainText = async (topic: Topic) => {
  const { topicToPlainText } = await import('./export')
  const plainText = await topicToPlainText(topic)
  await navigator.clipboard.writeText(plainText)
  window.toast.success(i18next.t('message.copy.success'))
}

export const copyMessageAsPlainText = async (message: Message) => {
  const { messageToPlainText } = await import('./export')
  const plainText = messageToPlainText(message)
  await navigator.clipboard.writeText(plainText)
  window.toast.success(i18next.t('message.copy.success'))
}
