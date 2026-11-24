import { loggerService } from '@logger'
import type { NormalToolResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import { Button, Tag } from 'antd'
import { CheckCircle2, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SkeletonValue } from './MessageAgentTools/GenericTools'
import { type AskUserQuestionItem, parseAskUserQuestionToolInput } from './MessageAgentTools/types'

const logger = loggerService.withContext('AskUserQuestionCard')

interface CardHeaderProps {
  currentIndex: number
  totalQuestions: number
  extra?: ReactNode
}

function CardHeader({ currentIndex, totalQuestions, extra }: CardHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-(--color-primary)" />
        <span className="font-semibold text-default-700">{t('agent.askUserQuestion.title')}</span>
      </div>
      <span className="text-default-500 text-xs">
        <SkeletonValue value={totalQuestions > 0 ? `${currentIndex + 1} / ${totalQuestions}` : null} width="40px" />
        {extra}
      </span>
    </div>
  )
}

interface NavigationProps {
  showPrevious?: boolean
  isFirst: boolean
  onPrevious: () => void
  rightButton: ReactNode
}

function Navigation({ showPrevious = true, isFirst, onPrevious, rightButton }: NavigationProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center border-default-200 border-t pt-3',
        showPrevious ? 'justify-between' : 'justify-end'
      )}>
      {showPrevious && (
        <Button icon={<ChevronLeft size={16} />} disabled={isFirst} onClick={onPrevious} className="flex items-center">
          {t('agent.askUserQuestion.previous')}
        </Button>
      )}
      {rightButton}
    </div>
  )
}

interface CompletedContentProps {
  question?: AskUserQuestionItem
  answer?: string
}

function CompletedContent({ question, answer }: CompletedContentProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Tag color={answer ? 'processing' : 'default'} className="m-0">
          <SkeletonValue value={question?.header} width="60px" />
        </Tag>
        {answer && <CheckCircle2 className="h-4 w-4 text-(--color-primary)" />}
      </div>
      <div className="text-default-700 text-sm">
        <SkeletonValue value={question?.question} width="100%" />
      </div>
      {answer && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-(--color-primary)" />
          <span className="text-(--color-primary) text-sm">{answer}</span>
        </div>
      )}
    </div>
  )
}

export function AskUserQuestionCard({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { t } = useTranslation()

  const { questions, answers } = useMemo(() => {
    const parsed = parseAskUserQuestionToolInput(toolResponse.arguments)

    if (!parsed?.questions?.length) {
      logger.debug('AskUserQuestion: no questions parsed', {
        status: toolResponse.status,
        hasArguments: !!toolResponse.arguments
      })
    }

    return {
      questions: parsed?.questions ?? [],
      answers: parsed?.answers ?? {}
    }
  }, [toolResponse.arguments, toolResponse.status])

  const [currentIndex, setCurrentIndex] = useState(0)
  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length
  const isFirstQuestion = currentIndex === 0
  const isLastQuestion = currentIndex === totalQuestions - 1

  const handlePrevious = useCallback(() => {
    if (!isFirstQuestion) setCurrentIndex((prev) => prev - 1)
  }, [isFirstQuestion])

  const handleNext = useCallback(() => {
    if (!isLastQuestion) setCurrentIndex((prev) => prev + 1)
  }, [isLastQuestion])

  const answeredCount = Object.keys(answers).length

  return (
    <div className="w-full max-w-xl rounded-xl border border-default-200 bg-default-100 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3">
        <CardHeader
          currentIndex={currentIndex}
          totalQuestions={totalQuestions}
          extra={answeredCount > 0 ? ` · ${answeredCount} ${t('agent.askUserQuestion.answered')}` : undefined}
        />

        <CompletedContent
          question={currentQuestion}
          answer={currentQuestion ? answers[currentQuestion.question] : undefined}
        />

        {totalQuestions > 1 && (
          <Navigation
            showPrevious
            isFirst={isFirstQuestion}
            onPrevious={handlePrevious}
            rightButton={
              <Button
                disabled={isLastQuestion}
                onClick={handleNext}
                className="flex items-center"
                iconPosition="end"
                icon={<ChevronRight size={16} />}>
                {t('agent.askUserQuestion.next')}
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}

export default AskUserQuestionCard
