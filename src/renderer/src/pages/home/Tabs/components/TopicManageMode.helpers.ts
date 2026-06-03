import type { Topic } from '@renderer/types'

export interface BatchTopicDeleteResult {
  canDelete: boolean
  remainingTopics: Topic[]
  nextActiveTopic?: Topic
}

export const getBatchTopicDeleteResult = (
  topics: Topic[],
  selectedIds: Set<string>,
  activeTopicId: string
): BatchTopicDeleteResult => {
  const remainingTopics = topics.filter((topic) => !selectedIds.has(topic.id))

  if (remainingTopics.length === 0) {
    return {
      canDelete: false,
      remainingTopics
    }
  }

  return {
    canDelete: true,
    remainingTopics,
    nextActiveTopic: selectedIds.has(activeTopicId) ? remainingTopics[0] : undefined
  }
}
