from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import List, Optional
from ..services import market_data_service as mds
from ..services.market_data_cache import clear_all_cache
from ..utils.symbol_mapper import SUPPORTED_SYMBOLS

router = APIRouter(prefix="/api/market", tags=["market"])

class RefreshSymbolRequest(BaseModel):
    symbol: str
    includeCandles: bool = True
    includeLastPrice: bool = True
    timeframe: str = "1d"

class RefreshAllRequest(BaseModel):
    symbols: List[str]
    includeCandles: bool = True
    includeLastPrice: bool = True

@router.get("/symbols")
def get_symbols():
    return {"symbols": SUPPORTED_SYMBOLS}

@router.get("/candles")
def get_candles(
    symbol: str = Query(...),
    timeframe: str = Query("1d"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    provider: str = Query("auto"),
    refresh: bool = Query(False),
):
    return mds.get_candles(symbol.upper(), timeframe, start, end, refresh=refresh)

@router.get("/last-price")
def get_last_price(
    symbol: str = Query(...),
    provider: str = Query("auto"),
    refresh: bool = Query(False),
):
    return mds.get_last_price(symbol.upper(), provider=provider, refresh=refresh)

@router.get("/eod")
def get_eod(
    symbol: str = Query(...),
    date: Optional[str] = Query(None),
    provider: str = Query("auto"),
    refresh: bool = Query(False),
):
    return mds.get_eod(symbol.upper(), date=date, refresh=refresh)

@router.post("/refresh-symbol")
def refresh_symbol(req: RefreshSymbolRequest):
    return mds.refresh_symbol(req.symbol.upper(), req.timeframe, req.includeCandles, req.includeLastPrice)

@router.post("/refresh-all")
def refresh_all(req: RefreshAllRequest):
    results = []
    for sym in req.symbols[:10]:  # hard cap to prevent abuse
        r = mds.refresh_symbol(sym.upper(), include_candles=req.includeCandles, include_last_price=req.includeLastPrice)
        results.append(r)
    return {"results": results, "count": len(results)}

@router.get("/provider-status")
def provider_status():
    return mds.get_provider_status()

@router.post("/cache/clear")
def clear_cache():
    clear_all_cache()
    return {"success": True, "message": "Market data cache cleared"}
