"""Disabled. This released a pilot lease by talking to production Redis and LiveKit.

Import does not open a socket. Running it fails before Docker.
"""


def main():
    raise SystemExit('Refusing to contact production Redis or LiveKit')


if __name__ == '__main__':
    main()
