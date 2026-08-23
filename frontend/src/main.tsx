import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { DataCacheProvider } from './components/DataCache'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DataCacheProvider>
        <App />
      </DataCacheProvider>
    </BrowserRouter>
  </React.StrictMode>
)
