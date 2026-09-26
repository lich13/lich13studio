import { MODEL_TEST_PATH } from '@renderer/services/modelTrace/routes'
import { Button } from 'antd'
import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

export default function ModelTestButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Button size="small" type="text" icon={<FlaskConical size={16} />} onClick={() => navigate(MODEL_TEST_PATH)}>
      {t('settings.modelTest.title')}
    </Button>
  )
}
