export const getTopicFulfilledActiveTopicId = (
  visibleActiveTopicId: string | null | undefined,
  currentTopicId: string | null | undefined
): string | null | undefined => {
  return visibleActiveTopicId || currentTopicId
}

export const shouldMarkTopicFulfilled = (topicId: string, currentTopicId: string | null | undefined): boolean => {
  return !currentTopicId || currentTopicId !== topicId
}
