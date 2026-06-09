from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from ..services.notification_service import (
    get_settings,
    save_settings,
    send_test_email,
    send_notification_email,
    add_to_history,
    get_history,
    mark_read,
    mark_all_read,
    clear_history,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class TestEmailRequest(BaseModel):
    email: str


class SendNotificationRequest(BaseModel):
    type: str
    category: str
    priority: str = "medium"
    title: str
    message: str
    asset: Optional[str] = None
    relatedPage: Optional[str] = None
    metadata: dict = {}


class MarkReadRequest(BaseModel):
    id: str


@router.get("/settings")
def get_notification_settings():
    return get_settings()


@router.post("/settings")
def save_notification_settings(settings: dict):
    save_settings(settings)
    return {"success": True}


@router.post("/test-email")
def test_email(req: TestEmailRequest):
    return send_test_email(req.email)


@router.post("/send")
def send_notification(req: SendNotificationRequest):
    event = add_to_history({
        "type": req.type,
        "category": req.category,
        "priority": req.priority,
        "title": req.title,
        "message": req.message,
        "asset": req.asset,
        "relatedPage": req.relatedPage,
        "metadata": req.metadata,
        "delivery": {"email": {"enabled": False, "status": "pending"}},
    })
    settings = get_settings()
    email_cfg = settings.get("email", {})
    if email_cfg.get("enabled") and email_cfg.get("recipient"):
        result = send_notification_email(req.title, req.message, email_cfg["recipient"], req.priority)
        event["delivery"]["email"]["status"] = "sent" if result["success"] else "failed"
        event["delivery"]["email"]["enabled"] = True
    return {"success": True, "deliveryStatus": event["delivery"]["email"]["status"]}


@router.get("/history")
def notification_history():
    return get_history()


@router.post("/mark-read")
def mark_notification_read(req: MarkReadRequest):
    mark_read(req.id)
    return {"success": True}


@router.post("/mark-all-read")
def mark_all_notifications_read():
    mark_all_read()
    return {"success": True}


@router.post("/clear-history")
def clear_notification_history():
    clear_history()
    return {"success": True}
