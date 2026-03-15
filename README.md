# 🪙 PennyWise — AI Receipt Scanner & Savings Advisor

> Snap a photo of any receipt. Get instant AI-powered savings suggestions.

## ✨ What It Does

PennyWise uses **Groq Vision AI** to read any grocery or dining receipt and:

- 📂 **Extracts every line item** with price and category automatically
- ⭐ **Scores your shopping 0–100** based on value for money
- 💡 **Finds cheaper alternatives** at Costco, Aldi, Walmart, and Trader Joe's
- 💬 **Chat with your receipts** — ask "why is my score low?" in plain English
- 📊 **Tracks spending history** with monthly bar charts and category breakdowns

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React + Vite | Component-based UI, fast HMR |
| AI Vision | Groq API (Llama 4 Scout) | Free tier, image reading |
| Charts | Recharts | Bar + pie chart visualizations |
| Storage | localStorage → DynamoDB (V2) | Browser persistence, no backend needed for V1 |

## 🏗 Architecture
```
Photo upload
    ↓
React converts image → base64
    ↓
POST to Groq Vision API
  • image data (base64)
  • prompt: extract items + find savings
    ↓
Groq returns structured JSON
  • store, date, total, savings_score
  • each item with category + store suggestion
    ↓
React saves to localStorage
    ↓
UI renders results + chat + dashboard
```

## 🚀 Running Locally
```bash
git clone https://github.com/lahari-badhe/pennywise.git
cd pennywise
npm install
```

Create `.env` file:
```
VITE_GROQ_KEY=your_groq_key_here
```

Get a free Groq API key at [console.groq.com](https://console.groq.com)
```bash
npm run dev
# open http://localhost:5173
```

## 📌 Project Versions

| Version | Features | Status |
|---------|----------|--------|
| **V1** | Receipt scan, savings score, chat, dashboard, localStorage | ✅ Complete |
| **V2** | AWS Lambda + DynamoDB + Plaid bank sync | 🔨 Planned |

## 🤖 Built With AI Assistance

Built using **Claude AI** as a development collaborator:
- Designed receipt parsing prompt (modified output schema for React compatibility)
- Debugged Groq API integration using structured response logging
- Scaffolded Recharts components (rewrote data transformation logic)

## 💡 Key Technical Decisions

**Why Groq instead of OpenAI?**
Free tier with vision support. OpenAI-compatible format means easy migration later.

**Why localStorage instead of a database?**
V1 tradeoff — zero infrastructure needed. V2 upgrades to DynamoDB with identical
code change (swap `localStorage.setItem` for a `fetch()` call to Lambda API).

**How does chat remember the receipt?**
The AI is stateless. Every message re-sends the full conversation history plus all
receipt data as context. Same pattern used by ChatGPT and Claude.

## 📄 License
MIT