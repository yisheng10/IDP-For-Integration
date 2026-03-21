import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CallProvider } from './context/CallContext' // <--- IMPORT THIS
import CallOverlay from './components/CallOverlay'   // <--- IMPORT THIS
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CallProvider>        {/* WRAP APP */}
        <CallOverlay />     {/* ADD OVERLAY */}
        <App />
      </CallProvider>
    </BrowserRouter>
  </StrictMode>,
)