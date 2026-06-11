from fastapi import APIRouter, HTTPException, Query
from pydantic import AliasChoices, BaseModel, Field

from ..services.metatrader_service import (
    MetaTraderServiceError,
    connect,
    diagnostics,
    disconnect,
    get_account,
    get_historical_data,
    get_history,
    get_positions,
    get_symbols,
    get_tick,
    health,
    sync,
    terminal_health,
    test_connection,
)

router = APIRouter(tags=["metatrader"])


class MetaTraderConnectRequest(BaseModel):
    version: str = Field(pattern="^(mt4|mt5)$")
    server: str
    login: str
    password: str
    accountType: str = Field(pattern="^(live|demo)$")
    passwordType: str = Field(pattern="^(master|investor)$")


class MetaTraderSyncRequest(BaseModel):
    connectionKey: str


class HistoricalDataRequest(BaseModel):
    symbol: str
    timeframe: str
    startDate: str = Field(validation_alias=AliasChoices("startDate", "start_date"))
    endDate: str = Field(validation_alias=AliasChoices("endDate", "end_date"))


def _raise(error: MetaTraderServiceError):
    raise HTTPException(
        status_code=400,
        detail={
            "success": False,
            "status": error.status,
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
            },
        },
    )


@router.get("/mt5/health")
def bridge_health():
    result = health()
    if result.get("healthy"):
        return {"status": "ok", **result}
    raise HTTPException(status_code=503, detail=result)


@router.post("/mt5/test-connection")
def mt5_test_connection(payload: MetaTraderConnectRequest | None = None):
    try:
        return test_connection(payload.model_dump() if payload else None)
    except MetaTraderServiceError as error:
        _raise(error)


@router.get("/api/v1/health")
def api_v1_health():
    """Bridge liveness — only checks the FastAPI process + MT5 Python package.
    Does NOT test whether the MetaTrader 5 terminal is running."""
    result = health()
    status_code = 200 if result.get("healthy") else 503
    if status_code != 200:
        raise HTTPException(status_code=status_code, detail=result)
    return {"status": "ok", **result}


@router.get("/api/v1/terminal/health")
def api_v1_terminal_health():
    """Deep health check: calls mt5.initialize() to verify the local MT5 terminal responds."""
    result = terminal_health()
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result)
    return result


@router.get("/api/v1/diagnostics")
def api_v1_diagnostics():
    """Full diagnostics: bridge runtime, terminal state, Python env, last error."""
    return diagnostics()


@router.post("/api/v1/connect")
def api_v1_connect(payload: MetaTraderConnectRequest):
    try:
        return connect(payload.model_dump())
    except MetaTraderServiceError as error:
        _raise(error)


@router.post("/api/v1/disconnect")
def api_v1_disconnect(payload: MetaTraderSyncRequest | None = None):
    if payload is None:
        return {"success": True, "status": "disconnected"}
    return disconnect(payload.connectionKey)


@router.get("/api/v1/account")
def api_v1_account(connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_account(connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


@router.get("/api/v1/positions")
def api_v1_positions(connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_positions(connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


@router.get("/api/v1/history")
def api_v1_history(connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_history(connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


@router.get("/api/v1/symbols")
def api_v1_symbols(connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_symbols(connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


@router.get("/api/v1/symbol/{symbol}/tick")
def api_v1_tick(symbol: str, connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_tick(symbol, connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


@router.post("/api/v1/historical-data")
def api_v1_historical_data(payload: HistoricalDataRequest, connection_key: str | None = Query(default=None, alias="connectionKey")):
    try:
        return get_historical_data(payload.symbol, payload.timeframe, payload.startDate, payload.endDate, connection_key)
    except MetaTraderServiceError as error:
        _raise(error)


metatrader_router = APIRouter(prefix="/api/metatrader", tags=["metatrader"])


@metatrader_router.post("/connect")
def connect_account(payload: MetaTraderConnectRequest):
    return api_v1_connect(payload)


@metatrader_router.post("/sync")
def sync_account(payload: MetaTraderSyncRequest):
    try:
        return sync(payload.connectionKey)
    except MetaTraderServiceError as error:
        _raise(error)


@metatrader_router.post("/disconnect")
def disconnect_account(payload: MetaTraderSyncRequest):
    return disconnect(payload.connectionKey)


@metatrader_router.get("/health")
def metatrader_health():
    return api_v1_health()


@metatrader_router.get("/bridge-status")
def metatrader_bridge_status():
    result = health()
    return {
        "configured": True,
        "ready": bool(result.get("healthy")),
        "provider": "local_python_mt5_bridge",
        "providerLabel": "Local Python MT5 Bridge",
        "message": result.get("message"),
    }


@metatrader_router.post("/test-connection")
def metatrader_test_connection(payload: MetaTraderConnectRequest | None = None):
    return mt5_test_connection(payload)


@metatrader_router.get("/symbols")
def metatrader_symbols():
    try:
        return {"success": True, "symbols": get_symbols()}
    except MetaTraderServiceError as error:
        _raise(error)


@metatrader_router.get("/tick/{symbol}")
def metatrader_tick(symbol: str):
    try:
        return {"success": True, "tick": get_tick(symbol)}
    except MetaTraderServiceError as error:
        _raise(error)


@metatrader_router.post("/historical-data")
def metatrader_historical_data(payload: HistoricalDataRequest):
    try:
        return {
            "success": True,
            "bars": get_historical_data(payload.symbol, payload.timeframe, payload.startDate, payload.endDate),
        }
    except MetaTraderServiceError as error:
        _raise(error)
