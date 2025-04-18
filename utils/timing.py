import time
from functools import wraps

def timing(label="Function"):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            print(f"[{label}] Starting...")
            start_time = time.time()
            result = func(*args, **kwargs)
            end_time = time.time()
            print(f"[{label}] Took {end_time - start_time:.4f} seconds.")
            return result
        return wrapper
    return decorator
