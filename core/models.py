"""Plain dataclasses shared across core. No ORM, no web types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, List, Dict

@dataclass(frozen=True)
class MenuSize:
    id: str
    code: str
    name: str

@dataclass(frozen=True)
class MenuItemSize:
    size_id: str
    size_code: str
    price: float

@dataclass(frozen=True)
class MenuItem:
    """One item in the menu."""
    id: str
    category_id: str
    category_code: str
    name: str
    price: float
    item_type: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    sizes: List[MenuItemSize] = field(default_factory=list)

@dataclass(frozen=True)
class MenuCategory:
    id: str
    code: str
    name: str
    items: List[MenuItem] = field(default_factory=list)

@dataclass(frozen=True)
class Menu:
    """The loaded menu, categorized."""
    categories: Dict[str, MenuCategory] = field(default_factory=dict)
    all_sizes: List[MenuSize] = field(default_factory=list)

@dataclass(frozen=True)
class BillItem:
    """One finalized line in the cart."""
    item: MenuItem
    size_code: Optional[str]
    crust: Optional[MenuItem]
    toppings: List[MenuItem]
    quantity: int
    unit_price: float
    subtotal: float

@dataclass(frozen=True)
class Bill:
    """Result of the pricing engine. All money values rounded to 2 dp."""
    items: List[BillItem]
    subtotal: float
    discount: float
    taxable: float
    gst: float
    total: float
