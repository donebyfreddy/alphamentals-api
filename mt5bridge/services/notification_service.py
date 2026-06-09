"""Notification service — stores settings and history in memory (demo) with email via SMTP."""
import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
import uuid

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

# In-memory storage
_notification_settings: dict = {}
_notification_history: list = []


def get_settings() -> dict:
    return _notification_settings


def save_settings(settings: dict) -> None:
    global _notification_settings
    _notification_settings = settings


def send_test_email(recipient: str) -> dict:
    """Send a test email. Returns {"success": bool, "message": str}."""
    if not SMTP_USERNAME or not SMTP_PASSWORD:
        return {
            "success": False,
            "message": "SMTP credentials not configured. Set SMTP_USERNAME and SMTP_PASSWORD in backend .env",
        }
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "[Alphamentals] Test Email"
        msg["From"] = SMTP_FROM_EMAIL or SMTP_USERNAME
        msg["To"] = recipient
        body = MIMEText(
            "<h2>Test email from Alphamentals Trading OS</h2>"
            "<p>Your email notifications are configured correctly.</p>"
            "<p style='color:#888;font-size:12px'>This is not financial advice.</p>",
            "html",
        )
        msg.attach(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.sendmail(msg["From"], [recipient], msg.as_string())
        return {"success": True, "message": "Test email sent successfully"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def send_notification_email(title: str, message: str, recipient: str, priority: str = "medium") -> dict:
    if not SMTP_USERNAME or not SMTP_PASSWORD or not recipient:
        return {"success": False, "message": "Email not configured"}
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Trading Alert] {title}"
        msg["From"] = SMTP_FROM_EMAIL or SMTP_USERNAME
        msg["To"] = recipient
        html = (
            f"<h2>{title}</h2><p>{message}</p><hr/>"
            f"<p style='color:#888;font-size:11px'>Priority: {priority}. "
            "This alert is for trading process management and risk awareness. "
            "It is not financial advice or a trade signal.</p>"
        )
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.sendmail(msg["From"], [recipient], msg.as_string())
        return {"success": True, "message": "Sent"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def add_to_history(notification: dict) -> dict:
    event = {
        **notification,
        "id": str(uuid.uuid4()),
        "createdAt": datetime.utcnow().isoformat(),
        "read": False,
    }
    _notification_history.append(event)
    return event


def get_history() -> list:
    return list(reversed(_notification_history))


def mark_read(notification_id: str) -> None:
    for n in _notification_history:
        if n["id"] == notification_id:
            n["read"] = True


def mark_all_read() -> None:
    for n in _notification_history:
        n["read"] = True


def clear_history() -> None:
    global _notification_history
    _notification_history = []
