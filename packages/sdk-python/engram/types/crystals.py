"""Crystal types for the Engram SDK.

ACL/sharing types and advanced operation types live here as the canonical
types for those operations. These are NOT deprecated.

All former entity aliases (Crystal, CrystalEdge), literal aliases
(CrystalType, CrystalVisibility, CrystalEdgeRelationship), and
deprecated CRUD param classes (CreateCrystalParams, UpdateCrystalParams,
ListCrystalsParams, SearchCrystalsParams, CrystalSearchResult) have been
removed per ADR-055. Use the unified types from
``engram.types.knowledge_crystal`` instead.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from engram.types.knowledge_crystal import (
    KnowledgeCrystal,
    MembershipAddedBy,
)

__all__ = [
    # ACL / Sharing types (canonical)
    "CrystalPermission",
    "GranteeType",
    "AclEntry",
    "ShareLink",
    "SharedCrystalResult",
    # Advanced operation parameters (canonical)
    "BulkAddParams",
    "ReorderParams",
    "GrantPermissionParams",
    "RevokePermissionParams",
    "CreateShareLinkParams",
    "ForkCrystalParams",
]

# Crystal permission levels:
#   "read"  - Can view crystal and its items
#   "copy"  - Can fork the crystal
#   "write" - Can modify crystal content
#   "admin" - Full control including ACL management
CrystalPermission = Literal["read", "copy", "write", "admin"]

# Types of grantees for crystal ACL:
#   "user"    - Individual user
#   "project" - Project-level access
#   "team"    - Team-level access
GranteeType = Literal["user", "project", "team"]


class AclEntry(BaseModel):
    """An access control list entry for a crystal."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    crystal_id: str = Field(alias="crystalId")
    grantee_type: GranteeType = Field(alias="granteeType")
    grantee_id: str = Field(alias="granteeId")
    permission: CrystalPermission
    granted_by: Optional[str] = Field(None, alias="grantedBy")
    granted_at: str = Field(alias="grantedAt")


class ShareLink(BaseModel):
    """A share link for a crystal."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    crystal_id: str = Field(alias="crystalId")
    token: str
    permission: Optional[CrystalPermission] = None
    created_by: str = Field(alias="createdBy")
    max_uses: Optional[int] = Field(None, alias="maxUses")
    use_count: int = Field(alias="useCount")
    expires_at: Optional[str] = Field(None, alias="expiresAt")
    created_at: str = Field(alias="createdAt")


class SharedCrystalResult(BaseModel):
    """Result of accessing a crystal via share link."""

    model_config = ConfigDict(populate_by_name=True)

    crystal: KnowledgeCrystal
    permission: Optional[CrystalPermission] = None


# ============================================================================
# Advanced Operation Parameters (canonical)
# ============================================================================


class BulkAddParams(BaseModel):
    """Parameters for bulk adding items to a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    item_ids: list[str]
    added_by: Optional[MembershipAddedBy] = None


class ReorderParams(BaseModel):
    """Parameters for reordering items in a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    item_ids: list[str]


class GrantPermissionParams(BaseModel):
    """Parameters for granting permission on a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    grantee_type: GranteeType
    grantee_id: str
    permission: CrystalPermission
    granted_by: Optional[str] = None


class RevokePermissionParams(BaseModel):
    """Parameters for revoking permission on a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    grantee_type: GranteeType
    grantee_id: str
    permission: CrystalPermission


class CreateShareLinkParams(BaseModel):
    """Parameters for creating a share link."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    created_by: Optional[str] = None
    permission: Optional[CrystalPermission] = None
    max_uses: Optional[int] = None
    expires_at: Optional[str] = None


class ForkCrystalParams(BaseModel):
    """Parameters for forking a crystal."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    new_owner_ids: list[str]
