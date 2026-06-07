// TradeBridgeEA.mq5
// AlphaMentals MT5 bridge EA.
// Phase 2 sends account info and open positions to the Node bridge.

#property strict

input string BridgeBaseUrl = "http://127.0.0.1:3001";
input string BridgeApiKey = "";
input string BridgeAccountId = "";
input int HeartbeatSeconds = 10;
input string WatchedSymbols = "XAUUSD,EURUSD,GBPUSD,DXY,USOIL";

string JsonEscape(string value)
  {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   return value;
  }

string JsonString(string value)
  {
   return "\"" + JsonEscape(value) + "\"";
  }

string JsonBool(bool value)
  {
   return value ? "true" : "false";
  }

string JsonNumber(double value)
  {
   return DoubleToString(value, 8);
  }

string JsonNumberOrNull(double value)
  {
   if(value == 0.0)
      return "null";
   return JsonNumber(value);
  }

string JsonDoubleValueOrNull(bool ok, double value)
  {
   if(!ok)
      return "null";
   return JsonNumber(value);
  }

string IsoTime(datetime value)
  {
   if(value <= 0)
      return "";
   string text = TimeToString(value, TIME_DATE | TIME_SECONDS);
   StringReplace(text, ".", "-");
   StringReplace(text, " ", "T");
   return text + "Z";
  }

string AccountId()
  {
   if(StringLen(BridgeAccountId) > 0)
      return BridgeAccountId;
   return IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "-" + AccountInfoString(ACCOUNT_SERVER);
  }

string BuildAccountJson()
  {
   string json = "{";
   json += "\"login\":" + JsonString(IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))) + ",";
   json += "\"server\":" + JsonString(AccountInfoString(ACCOUNT_SERVER)) + ",";
   json += "\"broker\":" + JsonString(AccountInfoString(ACCOUNT_COMPANY)) + ",";
   json += "\"name\":" + JsonString(AccountInfoString(ACCOUNT_NAME)) + ",";
   json += "\"balance\":" + JsonNumber(AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   json += "\"equity\":" + JsonNumber(AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   json += "\"margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN)) + ",";
   json += "\"freeMargin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + ",";
   json += "\"profit\":" + JsonNumber(AccountInfoDouble(ACCOUNT_PROFIT)) + ",";
   json += "\"currency\":" + JsonString(AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   json += "\"leverage\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   json += "\"tradeAllowed\":" + JsonBool((bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)) + ",";
   json += "\"company\":" + JsonString(AccountInfoString(ACCOUNT_COMPANY)) + ",";
   json += "\"terminalName\":" + JsonString(TerminalInfoString(TERMINAL_NAME)) + ",";
   json += "\"updatedAt\":" + JsonString(IsoTime(TimeCurrent()));
   json += "}";
   return json;
  }

string BuildPositionsJson()
  {
   string json = "[";
   int total = PositionsTotal();
   bool first = true;

   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      if(!first)
         json += ",";
      first = false;

      long positionType = PositionGetInteger(POSITION_TYPE);
      string typeText = positionType == POSITION_TYPE_BUY ? "buy" : "sell";
      datetime openedAt = (datetime)PositionGetInteger(POSITION_TIME);

      json += "{";
      json += "\"ticket\":" + JsonString(IntegerToString((long)ticket)) + ",";
      json += "\"symbol\":" + JsonString(PositionGetString(POSITION_SYMBOL)) + ",";
      json += "\"type\":" + JsonString(typeText) + ",";
      json += "\"volume\":" + JsonNumber(PositionGetDouble(POSITION_VOLUME)) + ",";
      json += "\"profit\":" + JsonNumber(PositionGetDouble(POSITION_PROFIT)) + ",";
      json += "\"openPrice\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_OPEN)) + ",";
      json += "\"currentPrice\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_CURRENT)) + ",";
      json += "\"stopLoss\":" + JsonNumberOrNull(PositionGetDouble(POSITION_SL)) + ",";
      json += "\"takeProfit\":" + JsonNumberOrNull(PositionGetDouble(POSITION_TP)) + ",";
      json += "\"openedAt\":" + JsonString(IsoTime(openedAt)) + ",";
      json += "\"swap\":" + JsonNumber(PositionGetDouble(POSITION_SWAP)) + ",";
      json += "\"magic\":" + IntegerToString((long)PositionGetInteger(POSITION_MAGIC)) + ",";
      json += "\"comment\":" + JsonString(PositionGetString(POSITION_COMMENT));
      json += "}";
     }

   json += "]";
   return json;
  }

string BuildQuotesJson()
  {
   string parts[];
   int total = StringSplit(WatchedSymbols, ',', parts);
   string json = "[";
   bool first = true;

   for(int i = 0; i < total; i++)
     {
      string symbol = parts[i];
      StringTrimLeft(symbol);
      StringTrimRight(symbol);

      if(StringLen(symbol) == 0)
         continue;

      SymbolSelect(symbol, true);

      MqlTick tick;
      bool hasTick = SymbolInfoTick(symbol, tick);
      double previousClose = iClose(symbol, PERIOD_D1, 1);
      double dailyHigh = iHigh(symbol, PERIOD_D1, 0);
      double dailyLow = iLow(symbol, PERIOD_D1, 0);
      bool hasPreviousClose = previousClose != 0.0;
      bool hasDailyHigh = dailyHigh != 0.0;
      bool hasDailyLow = dailyLow != 0.0;

      if(!first)
         json += ",";
      first = false;

      json += "{";
      json += "\"symbol\":" + JsonString(symbol) + ",";
      json += "\"bid\":" + JsonDoubleValueOrNull(hasTick, tick.bid) + ",";
      json += "\"ask\":" + JsonDoubleValueOrNull(hasTick, tick.ask) + ",";
      json += "\"last\":" + JsonDoubleValueOrNull(hasTick, tick.last) + ",";
      json += "\"high\":" + JsonDoubleValueOrNull(hasDailyHigh, dailyHigh) + ",";
      json += "\"low\":" + JsonDoubleValueOrNull(hasDailyLow, dailyLow) + ",";
      json += "\"previousClose\":" + JsonDoubleValueOrNull(hasPreviousClose, previousClose) + ",";
      json += "\"updatedAt\":" + JsonString(IsoTime(TimeCurrent())) + ",";
      json += "\"source\":\"mt5-bridge\"";
      json += "}";
     }

   json += "]";
   return json;
  }

bool PostHeartbeat()
  {
   if(StringLen(BridgeApiKey) == 0)
     {
      Print("BridgeApiKey is required.");
      return false;
     }

   string body = "{";
   body += "\"accountId\":" + JsonString(AccountId()) + ",";
   body += "\"account\":" + BuildAccountJson() + ",";
   body += "\"positions\":" + BuildPositionsJson() + ",";
   body += "\"quotes\":" + BuildQuotesJson();
   body += "}";

   string url = BridgeBaseUrl + "/ea/heartbeat";
   string headers = "Content-Type: application/json\r\nx-api-key: " + BridgeApiKey + "\r\n";
   char data[];
   char result[];
   string resultHeaders;
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);

   ResetLastError();
   int status = WebRequest("POST", url, headers, 10000, data, result, resultHeaders);
   if(status == -1)
     {
      Print("Heartbeat WebRequest failed. Error: ", GetLastError(), ". Add bridge URL to MT5 allowed WebRequest URLs.");
      return false;
     }

   if(status < 200 || status >= 300)
     {
      Print("Heartbeat rejected. HTTP status: ", status);
      return false;
     }

   return true;
  }

int OnInit()
  {
   Print("TradeBridgeEA scaffold loaded. Bridge URL: ", BridgeBaseUrl);
   EventSetTimer(MathMax(1, HeartbeatSeconds));
   PostHeartbeat();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("TradeBridgeEA scaffold unloaded. Reason: ", reason);
  }

void OnTimer()
  {
   PostHeartbeat();
  }

void OnTick()
  {
   // Timer-based sync keeps network requests predictable.
  }
