// TradeBridgeEA.mq5
// AlphaMentals MT5 bridge EA.
// Sends account heartbeats and live tick data directly to the Node API.

#property strict

input string BridgeBaseUrl    = "http://127.0.0.1:3001";
input string BridgeApiKey     = "285510e7bfe2158bcf2d73b05a24dc5110e5133a0d454a8ae4425e22d3b47865";   // must match EA_API_KEY in the Node API .env
input string BridgeAccountId  = "";
input int    HeartbeatSeconds = 10;
input string WatchedSymbols   = "XAUUSD,EURUSD,GBPUSD,DXY,USOIL";

// ── JSON helpers ──────────────────────────────────────────────────────────────

string JsonEscape(string value)
  {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   return value;
  }

string JsonString(string value)  { return "\"" + JsonEscape(value) + "\""; }
string JsonBool(bool value)      { return value ? "true" : "false"; }
string JsonNumber(double value)  { return DoubleToString(value, 8); }

string JsonNumberOrNull(double value)
  {
   if(value == 0.0) return "null";
   return JsonNumber(value);
  }

string IsoTime(datetime value)
  {
   if(value <= 0) return "1970-01-01T00:00:00Z";
   string text = TimeToString(value, TIME_DATE | TIME_SECONDS);
   StringReplace(text, ".", "-");
   StringReplace(text, " ", "T");
   return text + "Z";
  }

string EaAccountId()
  {
   if(StringLen(BridgeAccountId) > 0) return BridgeAccountId;
   return IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))
        + "-" + AccountInfoString(ACCOUNT_SERVER);
  }

// ── Account JSON ──────────────────────────────────────────────────────────────

string BuildAccountJson()
  {
   string j = "{";
   j += "\"login\":"      + JsonString(IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))) + ",";
   j += "\"server\":"     + JsonString(AccountInfoString(ACCOUNT_SERVER)) + ",";
   j += "\"broker\":"     + JsonString(AccountInfoString(ACCOUNT_COMPANY)) + ",";
   j += "\"name\":"       + JsonString(AccountInfoString(ACCOUNT_NAME)) + ",";
   j += "\"balance\":"    + JsonNumber(AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   j += "\"equity\":"     + JsonNumber(AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   j += "\"margin\":"     + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN)) + ",";
   j += "\"freeMargin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + ",";
   j += "\"profit\":"     + JsonNumber(AccountInfoDouble(ACCOUNT_PROFIT)) + ",";
   j += "\"currency\":"   + JsonString(AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   j += "\"leverage\":"   + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE));
   j += "}";
   return j;
  }

// ── UTF-8 encode WITHOUT null terminator ─────────────────────────────────────
//
// BUG: MQL5 StringToCharArray(str, arr, 0, WHOLE_ARRAY, CP_UTF8) always appends
// a null byte (\0) at the end of the array.  When sent as an HTTP body that byte
// is included in the payload, and Node.js JSON.parse throws:
//   "Unexpected non-whitespace character after JSON at position N"
// Fix: call StringToCharArray then resize the array to strip the trailing \0.

void StringToUTF8(const string text, uchar &buf[])
  {
   int len = StringToCharArray(text, buf, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(buf, len - 1);
  }

// ── HTTP POST ─────────────────────────────────────────────────────────────────

bool HttpPost(const string url, const string body, const string label, int timeoutMs = 8000)
  {
   Print("[ea] ", label, " body=", StringSubstr(body, 0, 300));

   uchar data[], result[];
   string resHeaders;
   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   if(StringLen(BridgeApiKey) > 0)
      headers += "x-api-key: " + BridgeApiKey + "\r\n";

   StringToUTF8(body, data);

   ResetLastError();
   int status = WebRequest("POST", url, headers, timeoutMs, data, result, resHeaders);

   if(status == -1)
     {
      int err = GetLastError();
      Print("[ea] ", label, " WebRequest error=", err,
            " — add URL to: MT5 Tools > Options > Expert Advisors > Allow WebRequest");
      return false;
     }

   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status < 200 || status >= 300)
     {
      Print("[ea] ", label, " HTTP=", status, " resp=", resp);
      return false;
     }

   Print("[ea] ", label, " HTTP=", status, " OK");
   return true;
  }

// ── Heartbeat ─────────────────────────────────────────────────────────────────

bool PostHeartbeat()
  {
   string body = "{";
   body += "\"accountId\":"  + JsonString(EaAccountId()) + ",";
   body += "\"account\":"    + BuildAccountJson() + ",";
   body += "\"timestamp\":"  + JsonString(IsoTime(TimeCurrent()));
   body += "}";
   return HttpPost(BridgeBaseUrl + "/ea/heartbeat", body, "heartbeat");
  }

// ── Single tick ───────────────────────────────────────────────────────────────

bool PostTick(const string symbol, double bid, double ask)
  {
   double price = (bid + ask) / 2.0;
   string body = "{";
   body += "\"symbol\":"    + JsonString(symbol) + ",";
   body += "\"bid\":"       + JsonNumber(bid) + ",";
   body += "\"ask\":"       + JsonNumber(ask) + ",";
   body += "\"price\":"     + JsonNumber(price) + ",";
   body += "\"timestamp\":" + JsonString(IsoTime(TimeCurrent()));
   body += "}";
   return HttpPost(BridgeBaseUrl + "/ea/tick", body, "tick " + symbol, 5000);
  }

// ── Tick batch: one tick per watched symbol ───────────────────────────────────

void PostAllWatchedTicks()
  {
   string parts[];
   int count = StringSplit(WatchedSymbols, ',', parts);
   for(int i = 0; i < count; i++)
     {
      string sym = parts[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) == 0) continue;

      SymbolSelect(sym, true);

      MqlTick tick;
      if(!SymbolInfoTick(sym, tick)) continue;
      if(tick.bid <= 0.0 || tick.ask <= 0.0) continue;

      PostTick(sym, tick.bid, tick.ask);
     }
  }

// ── EA lifecycle ──────────────────────────────────────────────────────────────

int OnInit()
  {
   Print("[ea] TradeBridgeEA starting. URL=", BridgeBaseUrl,
         " chart=", _Symbol, " account=", EaAccountId());
   EventSetTimer(MathMax(1, HeartbeatSeconds));
   PostHeartbeat();
   PostAllWatchedTicks();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("[ea] TradeBridgeEA stopped. reason=", reason);
  }

void OnTimer()
  {
   PostHeartbeat();
   PostAllWatchedTicks();
  }

void OnTick()
  {
   // Send a live tick for the current chart symbol on every price update.
   // Throttled: at most one POST per second so we don't flood the API.
   static datetime lastSent = 0;
   datetime now = TimeCurrent();
   if(now == lastSent) return;
   lastSent = now;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;
   if(tick.bid <= 0.0 || tick.ask <= 0.0) return;
   PostTick(_Symbol, tick.bid, tick.ask);
  }
