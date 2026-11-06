"""Disabled. This pilot reserved a production lease and copied egress config to the encoder.

Import does not open a socket. Running it fails before SSH, Redis, or LiveKit.
"""


def main():
    raise SystemExit('Refusing to contact production app, Redis, or encoder')


if __name__ == '__main__':
    main()
