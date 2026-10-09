import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { mapRouter } from './routes/map.ts'

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())          // 요청 본문의 JSON 을 읽을 수 있게 함
app.use('/api', mapRouter)

app.listen(PORT, () => {
  console.log(`서버 http://localhost:${PORT}`)
})