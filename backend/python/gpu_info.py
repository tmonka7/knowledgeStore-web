"""Which devices PyTorch can train on here, for the Train panels' device list.

    python gpu_info.py

stdout: one "done" event with the torch version, the CUDA version it was
built for (null for a CPU-only build), each CUDA GPU (id, name, memory), whether
Apple's MPS is available, and — when there is no GPU — why not.
"""
from ks_common import emit, gpu_unavailable_reason


def main():
    try:
        import torch
    except ImportError:
        emit("done", torch=None, cuda=None, devices=[], mps=False,
             reason="PyTorch is not installed. Run: pip install -r backend/python/requirements.txt")
        return

    devices = []
    if torch.cuda.is_available():
        for index in range(torch.cuda.device_count()):
            properties = torch.cuda.get_device_properties(index)
            devices.append({
                "id": f"cuda:{index}",
                "name": properties.name,
                "memoryGb": round(properties.total_memory / 1024 ** 3, 1),
            })
    mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    emit("done", torch=torch.__version__, cuda=torch.version.cuda, devices=devices, mps=mps,
         reason="" if devices or mps else gpu_unavailable_reason())


if __name__ == "__main__":
    main()
