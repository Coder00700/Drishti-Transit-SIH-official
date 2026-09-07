from datetime import datetime
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator, StringConstraints

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)

class Login(Strict):
    secure_id: str = Field(min_length=4, max_length=32, pattern=r'^[A-Za-z0-9-]+$')
    password: Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)]

class Content(Strict):
    area_id: str
    kind: Literal['HIGHLIGHT', 'ALERT', 'REPORT']
    title: str = Field(min_length=5, max_length=140)
    summary: str = Field(min_length=10, max_length=2000)
    status: Literal['REPORTED', 'IN_PROGRESS', 'RESOLVED'] = 'REPORTED'
    category: Literal['PROJECT', 'ACCIDENT', 'WATERLOGGING', 'RISK_ZONE', 'ROAD_REPAIR'] = 'ROAD_REPAIR'
    source: str = Field(min_length=3, max_length=300)
    resolution_note: str = Field(default='', max_length=1000)
    expires_at: datetime | None = None
    @field_validator('expires_at')
    @classmethod
    def timezone_required(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError('Include a timezone in the expiry timestamp.')
        return value

class EditContent(Content):
    revision: int = Field(ge=1)

class Transition(Strict):
    revision: int = Field(ge=1)
    action: Literal['publish', 'withdraw']

class ImportFile(Strict):
    area_id: str
    filename: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=2, max_length=1800000)

class PublishBatch(Strict):
    expected_batch_id: str | None = None

class GPS(Strict):
    timestamp: datetime
    video_ms: float = Field(ge=0, le=7200000)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(gt=0, le=10000)
    @field_validator('timestamp')
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError('GPS timestamps require timezone information.')
        return value

class Evidence(Strict):
    area_id: str
    filename: str = Field(min_length=1, max_length=150)
    content_type: Literal['video/mp4', 'video/webm', 'video/quicktime']
    byte_size: int = Field(gt=0, le=1073741824)
    duration_ms: int = Field(gt=0, le=7200000)
    recorded_at: datetime
    gps: list[GPS] = Field(min_length=2, max_length=10000)
    consent: Literal[True]
    gps_offset_ms: int = Field(default=0, ge=-7200000, le=7200000)
    timing_source: Literal['DEVICE_CAPTURE', 'USER_SUPPLIED']
    drive_url: str | None = Field(default=None, max_length=300, pattern=r'^https://drive\.google\.com/file/d/[A-Za-z0-9_-]+/(view|preview)(\?usp=sharing)?$')
    @field_validator('recorded_at')
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError('Recording start requires timezone information.')
        return value

class EvidenceReview(Strict):
    action: Literal['ACCEPTED', 'REJECTED']
    note: str = Field(min_length=5, max_length=1000)

class Part(Strict):
    part_number: int = Field(ge=1, le=128)

class CompletedPart(Part):
    etag: str = Field(min_length=1, max_length=100, pattern=r'^[a-zA-Z0-9"-]+$')

class CompleteUpload(Strict):
    parts: list[CompletedPart] = Field(min_length=1, max_length=128)

