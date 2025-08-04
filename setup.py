from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="deoverlap",
    version="0.1.0",
    author="Your Name",
    author_email="your.email@example.com",
    description="A Shapely-based geometry deduplication library with vpype integration",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/deoverlap",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Scientific/Engineering :: GIS",
        "Topic :: Multimedia :: Graphics",
    ],
    python_requires=">=3.8",
    install_requires=[
        "shapely>=2.0.0",
        "tqdm>=4.60.0",
        "numpy>=1.20.0",
    ],
    extras_require={
        "vpype": [
            "vpype>=1.9.0",
            "vpype-cli>=1.9.0",
            "click>=8.0.0",
        ],
        "dev": [
            "pytest>=6.0.0",
            "pytest-cov>=2.10.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
        ],
    },
    entry_points={
        "vpype.plugins": [
            "deoverlap = deoverlap.vpype_plugin:deduplicate",
        ],
    },
    include_package_data=True,
    zip_safe=False,
) 