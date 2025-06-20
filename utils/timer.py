from time import perf_counter

class Timer:
    def __init__(self):
        self.start = perf_counter()
        self.last = self.start

    def log(self, label):
        now = perf_counter()
        print(f"{label} took {now - self.last:.4f} seconds")
        self.last = now

    def total(self):
        print(f"Total time: {perf_counter() - self.start:.4f} seconds")
