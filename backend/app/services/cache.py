import time
from collections import OrderedDict
from collections.abc import Hashable
from typing import Generic, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    def __init__(self, ttl_seconds: int, max_items: int = 256) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_items = max_items
        self._items: OrderedDict[Hashable, tuple[float, T]] = OrderedDict()

    def get(self, key: Hashable) -> T | None:
        item = self._items.get(key)
        if item is None:
            return None

        expires_at, value = item
        if expires_at < time.monotonic():
            self._items.pop(key, None)
            return None

        self._items.move_to_end(key)
        return value

    def set(self, key: Hashable, value: T) -> T:
        self._items[key] = (time.monotonic() + self.ttl_seconds, value)
        self._items.move_to_end(key)
        while len(self._items) > self.max_items:
            self._items.popitem(last=False)
        return value
