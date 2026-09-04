"""Cloud account contracts, independent of the local AI/PostGIS backend."""
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

POLICY_VERSION = '2026-09-04-v2'


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Login(Input):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator('email')
    @classmethod
    def email_format(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address')
        return value


class Register(Login):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(pattern=r'^\+91[6-9][0-9]{9}$')
    adult: Literal[True]
    terms_accepted: Literal[True]
    privacy_accepted: Literal[True]
    policy_version: Literal['2026-09-04-v2']

    @field_validator('full_name', mode='before')
    @classmethod
    def clean_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('password')
    @classmethod
    def password_strength(cls, value):
        if len(value) < 12:
            raise ValueError('Use at least 12 characters for your password')
        return value


class Consent(Input):
    accepted: Literal[True]
    policy_version: Literal['2026-09-04-v2']


class OtpSend(Input):
    channel: Literal['email', 'sms']
    delivery_consent: Literal[True]


class OtpCheck(Input):
    channel: Literal['email', 'sms']
    code: str = Field(pattern=r'^[0-9]{4,10}$')
