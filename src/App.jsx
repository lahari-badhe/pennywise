import { useState, useRef, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const CAT_COLORS = {
  'Produce': '#4a7c43',
  'Dairy': '#6b9fd4',
  'Meat & Seafood': '#c8622a',
  'Pantry': '#d4a843',
  'Snacks': '#9b7ec8',
  'Beverages': '#4ab8c8',
  'Household': '#8a7f72',
  'Personal Care': '#d4688a',
  'Dining Out': '#e07b39',
  'Other': '#aaa49c',
}

function App() {
  const [view, setView] = useState('upload')
  const [receipt, setReceipt] = useState(null)
  const [scanStatus, setScanStatus] = useState('Reading receipt...')

  // ── allReceipts MUST come before messages ──
  const [allReceipts, setAllReceipts] = useState(() => {
    return JSON.parse(localStorage.getItem('pennywise-receipts') || '[]')
  })

  // ── messages initialized AFTER allReceipts ──
  const [messages, setMessages] = useState(() => {
    const saved = JSON.parse(localStorage.getItem('pennywise-receipts') || '[]')
    return [{
      role: 'assistant',
      content: saved.length > 0
        ? `Hi! I can see you have ${saved.length} receipt${saved.length > 1 ? 's' : ''} saved. Ask me anything about your spending!`
        : `Hi! I'm PennyWise. Scan your first receipt and I'll help you track and save money.`
    }]
  })

  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const fileRef = useRef(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function processFile(file) {
    setView('scanning')
    setScanStatus('Reading receipt...')

    try {
      const base64 = await toBase64(file)
      setScanStatus('Identifying items...')

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${file.type || 'image/jpeg'};base64,${base64}`
                }
              },
              {
                type: 'text',
                text: `Analyze this receipt and return ONLY a JSON object, no explanation, no markdown, no backticks.

Return exactly this shape:
{
  "store": "store name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "savings_score": 0,
  "savings_summary": "2 sentence summary of shopping habits",
  "total_potential_savings": 0.00,
  "items": [
    {
      "name": "item name",
      "price": 0.00,
      "category": "Produce or Dairy or Meat & Seafood or Pantry or Snacks or Beverages or Household or Personal Care or Other",
      "suggestion": null
    }
  ]
}

For suggestion, if there is a cheaper alternative at Costco, Aldi, Walmart or Trader Joes, use:
{
  "store": "Costco",
  "item": "specific product name",
  "price": 0.00,
  "savings_note": "one sentence explanation"
}

savings_score is 0-100 where 100 means excellent value choices.`
              }
            ]
          }]
        })
      })

      setScanStatus('Calculating savings...')

      const data = await response.json()
      const text = data.choices[0].message.content
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)

      const updated = [parsed, ...allReceipts]
      localStorage.setItem('pennywise-receipts', JSON.stringify(updated))
      setAllReceipts(updated)
      setReceipt(parsed)
      setMessages([{
        role: 'assistant',
        content: `I've analyzed your ${parsed.store} receipt. You scored ${parsed.savings_score}/100. Ask me anything about your spending!`
      }])
      setView('results')

    } catch (error) {
      console.error('Error:', error)
      alert('Something went wrong. Check the console for details.')
      setView('upload')
    }
  }

  // ── SEND MESSAGE ──────────────────────────────────────
  // works for BOTH results screen chat AND standalone chat
  async function sendMessage() {
    const text = chatInput.trim()
    if (!text || chatLoading) return

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setChatInput('')
    setChatLoading(true)

    try {
      // ── BUILD CONTEXT FROM ALL RECEIPTS ──
      // works whether or not a receipt is currently open
      let receiptContext = ''

      if (allReceipts.length > 0) {
        const totalSpent = allReceipts.reduce((s, r) => s + r.total, 0)
        const avgScore = Math.round(allReceipts.reduce((s, r) => s + r.savings_score, 0) / allReceipts.length)

        receiptContext = `
The user has ${allReceipts.length} receipts saved:

${allReceipts.map(r =>
  `📅 ${r.date} — ${r.store}: $${r.total} (score: ${r.savings_score}/100)
   Items: ${(r.items || []).map(i =>
     `${i.name} $${i.price}${i.suggestion ? ` → cheaper at ${i.suggestion.store}: $${i.suggestion.price}` : ''}`
   ).join(', ')}`
).join('\n\n')}

Total spent across all receipts: $${totalSpent.toFixed(2)}
Average savings score: ${avgScore}/100
Total potential savings: $${allReceipts.reduce((s, r) => s + (r.total_potential_savings || 0), 0).toFixed(2)}`
      } else {
        receiptContext = 'No receipts uploaded yet. Encourage the user to scan their first receipt.'
      }

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 300,
          messages: [
            {
              role: 'system',
              content: `You are PennyWise, a friendly personal finance assistant.
You have access to ALL of the user's receipt history below.
Answer questions concisely using specific numbers from their data.
Keep replies under 100 words. Be encouraging but honest about overspending.
If asked about spending patterns, trends, or monthly totals — use the full history.

RECEIPT DATA:
${receiptContext}`
            },
            ...newMessages.map(m => ({ role: m.role, content: m.content }))
          ]
        })
      })

      const data = await response.json()
      const reply = data.choices[0].message.content
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Try again!'
      }])
    }
    setChatLoading(false)
  }

  // ── UPLOAD SCREEN ──────────────────────────────────────
  if (view === 'upload') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#faf7f2',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Georgia, serif'
      }}>
        <h1 style={{ fontSize: 40, color: '#2d5a27', margin: '0 0 8px' }}>
          PennyWise
        </h1>
        <p style={{ color: '#8a7f72', marginBottom: 40 }}>
          Scan any receipt. Find every saving.
        </p>

        <div
          onClick={() => fileRef.current.click()}
          style={{
            width: 340,
            padding: '48px 32px',
            border: '2px dashed #e2d9ce',
            borderRadius: 16,
            background: 'white',
            textAlign: 'center',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
          <div style={{ fontSize: 16, color: '#1c1a17', marginBottom: 6 }}>
            Drop your receipt here
          </div>
          <div style={{ fontSize: 12, color: '#8a7f72' }}>
            JPG · PNG · any photo
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => processFile(e.target.files[0])}
          />
        </div>

        {allReceipts.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => setView('dashboard')}
              style={{
                padding: '12px 32px',
                background: 'transparent',
                border: '2px solid #2d5a27',
                color: '#2d5a27',
                cursor: 'pointer',
                fontSize: 13,
                borderRadius: 8
              }}
            >
              📊 Dashboard ({allReceipts.length} receipts)
            </button>
            <button
              onClick={() => {
                setMessages([{
                  role: 'assistant',
                  content: `Hi! I can see ${allReceipts.length} receipt${allReceipts.length > 1 ? 's' : ''} totalling $${allReceipts.reduce((s, r) => s + r.total, 0).toFixed(2)}. Ask me anything about your spending!`
                }])
                setView('chat')
              }}
              style={{
                padding: '12px 32px',
                background: '#2d5a27',
                border: '2px solid #2d5a27',
                color: 'white',
                cursor: 'pointer',
                fontSize: 13,
                borderRadius: 8
              }}
            >
              💬 Chat with Spending
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── SCANNING SCREEN ────────────────────────────────────
  if (view === 'scanning') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#faf7f2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Georgia, serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <h2 style={{ color: '#2d5a27' }}>Analyzing your receipt...</h2>
          <p style={{ color: '#8a7f72' }}>{scanStatus}</p>
        </div>
      </div>
    )
  }

  // ── RESULTS SCREEN ─────────────────────────────────────
  if (view === 'results') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#faf7f2',
        fontFamily: 'Georgia, serif'
      }}>
        <div style={{
          background: 'white',
          padding: '16px 24px',
          borderBottom: '1px solid #e2d9ce',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h1 style={{ margin: 0, fontSize: 22, color: '#2d5a27' }}>PennyWise</h1>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setView('dashboard')}
              style={{
                background: 'transparent', color: '#2d5a27',
                border: '2px solid #2d5a27', padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', fontSize: 13
              }}
            >
              📊 Dashboard
            </button>
            <button
              onClick={() => setView('upload')}
              style={{
                background: '#2d5a27', color: 'white',
                border: 'none', padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', fontSize: 13
              }}
            >
              + Scan New
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>

          {/* Receipt Summary */}
          <div style={{
            background: 'white', borderRadius: 16,
            padding: 24, marginBottom: 16,
            boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 24, color: '#1c1a17' }}>
                  {receipt.store}
                </h2>
                <p style={{ margin: '0 0 16px', color: '#8a7f72', fontSize: 13 }}>
                  {receipt.date} · {receipt.items.length} items
                </p>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#1c1a17' }}>
                  ${receipt.total.toFixed(2)}
                </div>
                {receipt.total_potential_savings > 0 && (
                  <div style={{ color: '#c8622a', fontSize: 13, marginTop: 4 }}>
                    💸 Could save ${receipt.total_potential_savings.toFixed(2)} with smarter choices
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: receipt.savings_score >= 75 ? '#e8f0e7' : receipt.savings_score >= 50 ? '#fdf5e8' : '#fdf0ea',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  border: `3px solid ${receipt.savings_score >= 75 ? '#2d5a27' : receipt.savings_score >= 50 ? '#d48b3a' : '#c8622a'}`
                }}>
                  <span style={{
                    fontSize: 22, fontWeight: 700,
                    color: receipt.savings_score >= 75 ? '#2d5a27' : receipt.savings_score >= 50 ? '#d48b3a' : '#c8622a'
                  }}>
                    {receipt.savings_score}
                  </span>
                  <span style={{ fontSize: 9, color: '#8a7f72' }}>/ 100</span>
                </div>
                <div style={{
                  fontSize: 11, marginTop: 6,
                  color: receipt.savings_score >= 75 ? '#2d5a27' : receipt.savings_score >= 50 ? '#d48b3a' : '#c8622a'
                }}>
                  {receipt.savings_score >= 75 ? 'Smart Shopper' : receipt.savings_score >= 50 ? 'Room to Improve' : 'Overspending Alert'}
                </div>
              </div>
            </div>
            <div style={{
              marginTop: 16, padding: '12px 16px',
              background: '#faf7f2', borderRadius: 10,
              fontSize: 13, color: '#8a7f72',
              fontStyle: 'italic', lineHeight: 1.6
            }}>
              "{receipt.savings_summary}"
            </div>
          </div>

          {/* Items */}
          <div style={{
            background: 'white', borderRadius: 16,
            padding: '20px', marginBottom: 16,
            boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1c1a17' }}>🧾 Items</h3>
            {receipt.items.map((item, i) => (
              <div key={i} style={{
                borderBottom: i < receipt.items.length - 1 ? '1px solid #e2d9ce' : 'none',
                padding: '12px 0'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 14, color: '#1c1a17' }}>{item.name}</span>
                    <span style={{
                      marginLeft: 8, fontSize: 11,
                      padding: '2px 8px', borderRadius: 20,
                      background: '#e8f0e7', color: '#2d5a27'
                    }}>
                      {item.category}
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1c1a17' }}>
                    ${item.price.toFixed(2)}
                  </span>
                </div>
                {item.suggestion && (
                  <div style={{
                    marginTop: 8, padding: '10px 14px',
                    background: '#fdf0ea', borderRadius: 8,
                    border: '1px solid #c8622a30'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#c8622a' }}>
                        🏪 {item.suggestion.store}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2d5a27' }}>
                        ${item.suggestion.price.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#1c1a17', marginBottom: 3 }}>
                      {item.suggestion.item}
                    </div>
                    <div style={{ fontSize: 11, color: '#c8622a' }}>
                      {item.suggestion.savings_note}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Chat on results screen */}
          <div style={{
            background: 'white', borderRadius: 16,
            padding: '20px',
            boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1c1a17' }}>
              💬 Ask About This Receipt
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {['Why is my score low?', 'Where can I save most?', 'Is this normal spending?'].map(q => (
                <button key={q} onClick={() => setChatInput(q)} style={{
                  padding: '6px 12px', background: '#f0f0f0',
                  border: '1px solid #e2d9ce', borderRadius: 20,
                  fontSize: 12, color: '#8a7f72', cursor: 'pointer'
                }}>
                  {q}
                </button>
              ))}
            </div>
            <div style={{
              maxHeight: 280, overflowY: 'auto',
              marginBottom: 12, display: 'flex',
              flexDirection: 'column', gap: 10
            }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                }}>
                  <div style={{
                    maxWidth: '80%', padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? '#2d5a27' : '#faf7f2',
                    color: msg.role === 'user' ? 'white' : '#1c1a17',
                    fontSize: 13, lineHeight: 1.5
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '10px 14px', background: '#faf7f2',
                    borderRadius: '16px 16px 16px 4px',
                    color: '#8a7f72', fontSize: 18, letterSpacing: 2
                  }}>···</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Ask anything about this receipt..."
                style={{
                  flex: 1, padding: '10px 14px',
                  border: '1px solid #e2d9ce', borderRadius: 10,
                  fontSize: 13, outline: 'none',
                  fontFamily: 'Georgia, serif'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  padding: '10px 20px',
                  background: chatLoading || !chatInput.trim() ? '#e2d9ce' : '#2d5a27',
                  color: 'white', border: 'none',
                  borderRadius: 10, cursor: 'pointer', fontSize: 13
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── STANDALONE CHAT SCREEN ─────────────────────────────
  if (view === 'chat') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#faf7f2',
        fontFamily: 'Georgia, serif',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          background: 'white', padding: '16px 24px',
          borderBottom: '1px solid #e2d9ce',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h1 style={{ margin: 0, fontSize: 22, color: '#2d5a27' }}>PennyWise</h1>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setView('dashboard')} style={{
              background: 'transparent', color: '#2d5a27',
              border: '2px solid #2d5a27', padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', fontSize: 13
            }}>📊 Dashboard</button>
            <button onClick={() => setView('upload')} style={{
              background: '#2d5a27', color: 'white',
              border: 'none', padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', fontSize: 13
            }}>+ Scan Receipt</button>
          </div>
        </div>

        {/* Stats bar */}
        {allReceipts.length > 0 && (
          <div style={{
            background: 'white', borderBottom: '1px solid #e2d9ce',
            padding: '12px 24px', display: 'flex', gap: 32
          }}>
            {[
              { label: 'RECEIPTS', val: allReceipts.length },
              { label: 'TOTAL SPENT', val: `$${allReceipts.reduce((s, r) => s + r.total, 0).toFixed(2)}` },
              { label: 'AVG SCORE', val: `${Math.round(allReceipts.reduce((s, r) => s + r.savings_score, 0) / allReceipts.length)}/100` },
              { label: 'COULD SAVE', val: `$${allReceipts.reduce((s, r) => s + (r.total_potential_savings || 0), 0).toFixed(2)}` },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 9, color: '#8a7f72', letterSpacing: 2, fontFamily: 'monospace' }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#2d5a27', fontFamily: 'monospace' }}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '24px 16px',
          maxWidth: 640, width: '100%',
          margin: '0 auto',
          display: 'flex', flexDirection: 'column', gap: 12
        }}>
          {/* Suggestion pills — only show at start */}
          {messages.length <= 1 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 11, color: '#8a7f72',
                fontFamily: 'monospace', letterSpacing: 1, marginBottom: 10
              }}>
                TRY ASKING
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  'How much did I spend this month?',
                  'Where am I overspending?',
                  'What should I buy at Costco?',
                  'Compare my last two receipts',
                  'What is my worst spending habit?',
                  'How can I save $50 this month?'
                ].map(q => (
                  <button key={q} onClick={() => setChatInput(q)} style={{
                    padding: '7px 14px', background: 'white',
                    border: '1px solid #e2d9ce', borderRadius: 20,
                    fontSize: 12, color: '#8a7f72', cursor: 'pointer',
                    fontFamily: 'Georgia, serif'
                  }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                maxWidth: '80%', padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? '#2d5a27' : 'white',
                color: msg.role === 'user' ? 'white' : '#1c1a17',
                fontSize: 14, lineHeight: 1.6,
                boxShadow: '0 2px 8px rgba(28,26,23,0.06)'
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '12px 16px', background: 'white',
                borderRadius: '16px 16px 16px 4px',
                color: '#8a7f72', fontSize: 18, letterSpacing: 3
              }}>···</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{
          background: 'white', borderTop: '1px solid #e2d9ce',
          padding: '16px 24px'
        }}>
          <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={allReceipts.length > 0
                ? "Ask about your spending history..."
                : "Scan a receipt first to start chatting..."
              }
              style={{
                flex: 1, padding: '12px 16px',
                border: '1px solid #e2d9ce', borderRadius: 10,
                fontSize: 14, outline: 'none',
                fontFamily: 'Georgia, serif'
              }}
            />
            <button
              onClick={sendMessage}
              disabled={chatLoading || !chatInput.trim()}
              style={{
                padding: '12px 24px',
                background: chatLoading || !chatInput.trim() ? '#e2d9ce' : '#2d5a27',
                color: 'white', border: 'none',
                borderRadius: 10,
                cursor: chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── DASHBOARD ──────────────────────────────────────────
  if (view === 'dashboard') {
    const totalSpent = allReceipts.reduce((sum, r) => sum + r.total, 0)
    const totalSavings = allReceipts.reduce((sum, r) => sum + (r.total_potential_savings || 0), 0)
    const avgScore = allReceipts.length
      ? Math.round(allReceipts.reduce((sum, r) => sum + r.savings_score, 0) / allReceipts.length)
      : 0

    const monthlyMap = {}
    allReceipts.forEach(r => {
      const month = r.date?.slice(0, 7) || 'Unknown'
      monthlyMap[month] = (monthlyMap[month] || 0) + r.total
    })
    const monthlyData = Object.entries(monthlyMap)
      .sort()
      .map(([month, total]) => ({
        month: new Date(month + '-01').toLocaleString('default', { month: 'short' }),
        total: +total.toFixed(2)
      }))

    const catMap = {}
    allReceipts.flatMap(r => r.items || []).forEach(item => {
      catMap[item.category] = (catMap[item.category] || 0) + item.price
    })
    const catData = Object.entries(catMap)
      .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
      .sort((a, b) => b.value - a.value)

    return (
      <div style={{ minHeight: '100vh', background: '#faf7f2', fontFamily: 'Georgia, serif' }}>
        <div style={{
          background: 'white', padding: '16px 24px',
          borderBottom: '1px solid #e2d9ce',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <h1 style={{ margin: 0, fontSize: 22, color: '#2d5a27' }}>PennyWise</h1>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => {
              setMessages([{
                role: 'assistant',
                content: `Hi! I can see ${allReceipts.length} receipts totalling $${allReceipts.reduce((s, r) => s + r.total, 0).toFixed(2)}. Ask me anything!`
              }])
              setView('chat')
            }} style={{
              background: 'transparent', color: '#2d5a27',
              border: '2px solid #2d5a27', padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', fontSize: 13
            }}>💬 Chat</button>
            <button onClick={() => setView('upload')} style={{
              background: '#2d5a27', color: 'white',
              border: 'none', padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', fontSize: 13
            }}>+ Scan Receipt</button>
          </div>
        </div>

        <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>
          <h2 style={{ fontSize: 26, color: '#1c1a17', margin: '0 0 6px' }}>Your Dashboard</h2>
          <p style={{ color: '#8a7f72', fontSize: 13, margin: '0 0 24px' }}>
            {allReceipts.length} receipts tracked
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'TOTAL SPENT', value: `$${totalSpent.toFixed(2)}`, color: '#1c1a17', bg: 'white' },
              { label: 'COULD SAVE', value: `$${totalSavings.toFixed(2)}`, color: '#c8622a', bg: '#fdf0ea' },
              { label: 'AVG SCORE', value: `${avgScore}/100`, color: avgScore >= 75 ? '#2d5a27' : avgScore >= 50 ? '#d48b3a' : '#c8622a', bg: '#e8f0e7' },
            ].map(s => (
              <div key={s.label} style={{
                background: s.bg, borderRadius: 14,
                padding: '16px 12px', textAlign: 'center',
                boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
              }}>
                <div style={{ fontSize: 9, color: '#8a7f72', letterSpacing: 2, marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {monthlyData.length > 0 && (
            <div style={{
              background: 'white', borderRadius: 16,
              padding: 20, marginBottom: 16,
              boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
            }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1c1a17' }}>Monthly Spending</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={monthlyData}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8a7f72' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#8a7f72' }} axisLine={false} tickLine={false} tickFormatter={v => '$' + v} />
                  <Tooltip formatter={v => ['$' + v.toFixed(2), 'Spent']} />
                  <Bar dataKey="total" fill="#2d5a27" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {catData.length > 0 && (
            <div style={{
              background: 'white', borderRadius: 16,
              padding: 20, marginBottom: 16,
              boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
            }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1c1a17' }}>Spending by Category</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={catData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                      {catData.map((entry, i) => (
                        <Cell key={i} fill={CAT_COLORS[entry.name] || '#aaa'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={v => '$' + v.toFixed(2)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {catData.map(c => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[c.name] || '#aaa', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: '#1c1a17' }}>{c.name}</span>
                      <span style={{ fontSize: 12, color: '#8a7f72', marginLeft: 'auto' }}>${c.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={{
            background: 'white', borderRadius: 16,
            padding: 20, boxShadow: '0 2px 16px rgba(28,26,23,0.08)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#1c1a17' }}>Receipt History</h3>
            {allReceipts.length === 0 ? (
              <p style={{ color: '#8a7f72', fontSize: 13 }}>No receipts yet. Scan your first one!</p>
            ) : (
              allReceipts.map((r, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setReceipt(r)
                    setView('results')
                    setMessages([{ role: 'assistant', content: `Showing your ${r.store} receipt. Ask me anything!` }])
                  }}
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', padding: '12px 0',
                    borderBottom: i < allReceipts.length - 1 ? '1px solid #e2d9ce' : 'none',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1a17' }}>{r.store}</div>
                    <div style={{ fontSize: 11, color: '#8a7f72', marginTop: 2 }}>
                      {r.date} · {(r.items || []).length} items
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1c1a17' }}>${r.total.toFixed(2)}</div>
                    <div style={{
                      fontSize: 11,
                      color: r.savings_score >= 75 ? '#2d5a27' : r.savings_score >= 50 ? '#d48b3a' : '#c8622a'
                    }}>
                      Score: {r.savings_score}/100
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => {
              localStorage.removeItem('pennywise-receipts')
              setAllReceipts([])
            }}
            style={{
              marginTop: 16, width: '100%',
              padding: '12px', background: 'transparent',
              border: '1px solid #e2d9ce', borderRadius: 10,
              color: '#8a7f72', cursor: 'pointer', fontSize: 12
            }}
          >
            🗑 Clear all receipts
          </button>
        </div>
      </div>
    )
  }
}

export default App