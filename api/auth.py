"""Authentication + account management routes (additive, /api/auth/*).

Included by api/routes.py, so every surface that mounts the shared API router
gets these endpoints. Sign-in model (see CLAUDE.md):

  * user (customer)                — phone + 6-digit PIN, public signup
  * admin                          — email + password, seeded (no public signup)
  * staff / kitchen_staff / delivery — emp_id + 6-digit PIN, created by admin

Business errors follow the API's {"ok": False, "errors": {...}} convention;
only token/role failures use HTTP 401/403 (raised by api/security.py deps).
Customer name/phone rules are core/validation.py — reused, never rewritten.
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api import security
from core import validation as v
from db import users as db_users

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth")

_PIN_RE = re.compile(r"^\d{6}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Which column each role signs in with.
_LOGIN_FIELD = {
    "user": "phone",
    "admin": "email",
    "staff": "emp_id",
    "kitchen_staff": "emp_id",
    "delivery": "emp_id",
}

_BAD_CREDENTIALS = "We couldn't sign you in — check your details and try again."


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #


class SignupReq(BaseModel):
    name: str = ""
    phone: str = ""
    pin: str = ""
    confirm_pin: str = ""


class LoginReq(BaseModel):
    role: str = "user"
    identifier: str = ""  # phone (user) | email (admin) | emp_id (employees)
    secret: str = ""  # PIN or password


class AddressReq(BaseModel):
    address: list[dict] = []


class EmployeeCreateReq(BaseModel):
    name: str = ""
    phone: str = ""
    role: str = ""  # staff | kitchen_staff | delivery
    pin: str = ""


class EmployeeUpdateReq(BaseModel):
    is_active: bool | None = None
    pin: str | None = None  # set → reset the employee's PIN


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _errors(**errors: str) -> dict:
    return {"ok": False, "errors": {k: val for k, val in errors.items() if val}}


def _token_response(user: dict) -> dict:
    return {
        "ok": True,
        "token": security.issue_token(str(user["id"]), user["role"]),
        "user": user,
    }


def _validate_pin(pin: str, confirm: str | None = None) -> str | None:
    if not _PIN_RE.match(pin or ""):
        return "PIN must be exactly 6 digits."
    if confirm is not None and pin != confirm:
        return "PINs don't match."
    return None


# --------------------------------------------------------------------------- #
# Signup (customers only) + login (all roles)
# --------------------------------------------------------------------------- #


@router.post("/signup")
def signup(req: SignupReq):
    ok_n, name = v.validate_name(req.name)
    ok_p, phone = v.validate_phone(req.phone)
    pin_err = _validate_pin(req.pin, req.confirm_pin)
    if not ok_n or not ok_p or pin_err:
        return _errors(
            name=None if ok_n else name,
            phone=None if ok_p else phone,
            pin=pin_err,
        )
    try:
        if db_users.get_by_login("phone", phone):
            return _errors(
                phone="This phone number is already registered — sign in instead."
            )
        user = db_users.create_user(
            role="user",
            name=name,
            phone=phone,
            secret_hash=security.hash_secret(req.pin),
        )
    except Exception as exc:
        log.warning("Signup failed for %s: %s", phone, exc)
        return _errors(db="Couldn't create your account right now. Try again.")
    return _token_response(user)


@router.post("/login")
def login(req: LoginReq):
    field = _LOGIN_FIELD.get(req.role)
    if field is None:
        return _errors(role="Unknown role.")
    identifier = (req.identifier or "").strip()
    
    # Support logging in by employee code for all roles:
    if identifier.lower().startswith("emp") or identifier.lower().startswith("smemp"):
        field = "emp_id"
        identifier = identifier.lower()
    elif req.role == "admin":
        identifier = identifier.lower()

    if not identifier or not (req.secret or "").strip():
        return _errors(credentials="Enter your details to sign in.")

    try:
        row = db_users.get_by_login(field, identifier)
    except Exception as exc:
        log.warning("Login lookup failed: %s", exc)
        return _errors(db="Sign-in is unavailable right now. Try again shortly.")

    # One generic message for "no account" / "wrong role" / "wrong secret" —
    # never reveal which part failed (e.g. staff creds on the delivery screen).
    if row is None or row.get("role") != req.role:
        return _errors(credentials=_BAD_CREDENTIALS)
    if not row.get("is_active", True):
        return _errors(credentials="This account has been deactivated.")

    locked, msg = security.lock_state(row)
    if locked:
        return _errors(credentials=msg)

    if not security.verify_secret(req.secret, row.get("secret_hash") or ""):
        attempts, locked_until = security.next_failure_state(row)
        try:
            db_users.record_login_failure(str(row["id"]), attempts, locked_until)
        except Exception as exc:
            log.warning("Could not record login failure: %s", exc)
        if locked_until:
            return _errors(
                credentials="Too many wrong attempts. Try again in "
                f"{security.LOCKOUT_MINUTES} min."
            )
        return _errors(credentials=_BAD_CREDENTIALS)

    try:
        db_users.record_login_success(str(row["id"]))
    except Exception as exc:
        log.warning("Could not reset lockout counters: %s", exc)
    row.pop("secret_hash", None)
    row.pop("failed_attempts", None)
    row.pop("locked_until", None)
    return _token_response(row)


# --------------------------------------------------------------------------- #
# Current account
# --------------------------------------------------------------------------- #


@router.get("/me")
def me(claims: dict = Depends(security.get_current_claims)):
    try:
        user = db_users.get_by_id(claims["sub"])
    except Exception as exc:
        log.warning("Me lookup failed: %s", exc)
        return _errors(db="Account service is unavailable right now.")
    if user is None or not user.get("is_active", True):
        return _errors(credentials="This account no longer exists.")
    return {"ok": True, "user": user}


@router.put("/me/address")
def update_address(
    req: AddressReq, claims: dict = Depends(security.get_current_claims)
):
    """Save the customer's delivery addresses (required before delivery orders)."""
    cleaned = []
    for a in req.address:
        line = str(a.get("line") or "").strip()
        if not line:
            return _errors(address="Address can't be empty.")
        cleaned.append(
            {
                "id": str(a.get("id") or f"addr-{len(cleaned) + 1}"),
                "label": str(a.get("label") or "Home").strip() or "Home",
                "line": line,
                "isDefault": bool(a.get("isDefault")),
            }
        )
    try:
        user = db_users.update_user(claims["sub"], {"address": cleaned})
    except Exception as exc:
        log.warning("Address update failed: %s", exc)
        return _errors(db="Couldn't save your address right now. Try again.")
    if user is None:
        return _errors(credentials="This account no longer exists.")
    return {"ok": True, "user": user}


# --------------------------------------------------------------------------- #
# Employee management (admin only)
# --------------------------------------------------------------------------- #

_admin = Depends(security.require_role("admin"))


@router.get("/employees")
def employees(claims: dict = _admin):
    try:
        return {"ok": True, "employees": db_users.list_employees()}
    except Exception as exc:
        log.warning("Employee list failed: %s", exc)
        return _errors(db="Account service is unavailable right now.")


@router.post("/employees")
def create_employee(req: EmployeeCreateReq, claims: dict = _admin):
    ok_n, name = v.validate_name(req.name)
    ok_p, phone = v.validate_phone(req.phone)
    pin_err = _validate_pin(req.pin)
    role_err = (
        None
        if req.role in db_users.EMPLOYEE_ROLES
        else "Role must be staff, kitchen_staff or delivery."
    )
    if not ok_n or not ok_p or pin_err or role_err:
        return _errors(
            name=None if ok_n else name,
            phone=None if ok_p else phone,
            pin=pin_err,
            role=role_err,
        )
    try:
        if db_users.get_by_login("phone", phone):
            return _errors(phone="This phone number already has an account.")
        emp = db_users.create_user(
            role=req.role,
            name=name,
            phone=phone,
            secret_hash=security.hash_secret(req.pin),
        )
    except Exception as exc:
        log.warning("Employee create failed: %s", exc)
        return _errors(db="Couldn't create the employee right now. Try again.")
    # The admin shares emp_id + PIN with the employee out-of-band.
    return {"ok": True, "employee": emp}


@router.patch("/employees/{user_id}")
def update_employee(user_id: str, req: EmployeeUpdateReq, claims: dict = _admin):
    fields: dict = {}
    if req.pin is not None:
        pin_err = _validate_pin(req.pin)
        if pin_err:
            return _errors(pin=pin_err)
        fields["secret_hash"] = security.hash_secret(req.pin)
        # A PIN reset also clears any lockout so the employee can retry at once.
        fields["failed_attempts"] = 0
        fields["locked_until"] = None
    if req.is_active is not None:
        fields["is_active"] = req.is_active
    if not fields:
        return _errors(update="Nothing to update.")
    try:
        target = db_users.get_by_id(user_id)
        if target is None or target.get("role") not in db_users.EMPLOYEE_ROLES:
            return _errors(update="No such employee.")
        emp = db_users.update_user(user_id, fields)
    except Exception as exc:
        log.warning("Employee update failed: %s", exc)
        return _errors(db="Couldn't update the employee right now. Try again.")
    return {"ok": True, "employee": emp}
