"""Independent §5.3 reference implementation: deliberately imports no pipeline code."""
import hashlib
def choose(markets, randomness, n):
    return sorted(markets, key=lambda m:hashlib.sha256((randomness+":"+m["id"]).encode()).hexdigest())[:n]
