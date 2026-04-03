# Configuration Reference

## Radio Settings

The UI always builds a MeshCore CLI radio command in this format:

```text
set radio <frequency>,<bandwidth>,<sf>,<cr>
```

Validation ranges enforced in the browser:

| Field | Allowed Range |
| --- | --- |
| Frequency | `150` to `960` MHz |
| Bandwidth | `7.8` to `500` kHz |
| SF | `5` to `12` |
| CR | `5` to `8` |

Preset profiles populate those fields, but operators can switch to `CUSTOM` and enter
their own values.

## Identity And Access

### Repeater Name

- optional
- maximum `31` characters
- rejected characters: `[ ] \ : , ? *`
- if left blank, the app keeps the current captured name when available

### Private Key

- optional
- must be exactly `128` hexadecimal characters if provided
- sent with `set prv.key ...`
- changing the private key affects default MQTT topic generation because the default
  path includes the public key derived from the device

### Guest Password

- optional
- maximum `15` characters
- written with `set guest.password ...`

### Admin Password

- optional
- maximum `15` characters
- sent as `password ...`
- not read back from the device by backup export

### Latitude And Longitude

- optional
- latitude must be between `-90` and `90`
- longitude must be between `-180` and `180`

## WiFi Transport

The WiFi section writes:

- `set mqtt.wifi.ssid ...`
- `set mqtt.wifi.pass ...`

These values are also included in browser backup exports.

## Shared MQTT Fields

Two fields apply to all enabled brokers:

- `mqtt.model`
- `mqtt.client.version`

These are written only when non-empty.

## Broker Model

The application supports `6` physical MQTT slots grouped into `3` logical pairs:

| Logical Pair | Primary Slot | Optional Status Slot |
| --- | --- | --- |
| Pair 1 | Broker 1 | Broker 2 |
| Pair 2 | Broker 3 | Broker 4 |
| Pair 3 | Broker 5 | Broker 6 |

Mode behavior:

- `Simple` mode enables broker 1 only.
- `Advanced` mode can enable up to three logical pairs through `Additional MQTT Broker
  Pairs`.

Every broker record contains:

- URI
- username
- password
- topic root
- IATA code
- retain status flag
- enabled flag

## Default Topic Root Logic

If `Use MeshCore default topic root` is enabled for a broker, the UI derives the topic
root from:

```text
meshcore/{IATA}/{PUBLIC_KEY}/packets
```

Important constraints:

- the app needs captured device info to know the public key
- if you enter a new private key that differs from the captured one, you must apply the
  key first and then read device info again before relying on the default topic path

## Retain Status And Auto Status Brokers

If retain status is enabled on primary brokers `1`, `3`, or `5`, the UI derives a
status topic from the primary topic root. For a custom topic root, retain status only
works when the topic root ends in `/packets`.

In advanced mode, an optional status broker can be enabled for each logical pair. When
retain status is on and the status broker is not manually enabled, the app can
auto-generate the status broker record by copying connection details from the primary
broker and deriving the status topic root.

## Apply Modes And CLI Commands

`Apply All Settings` can send commands in this order:

1. `set radio ...`
2. identity commands such as `set name`, `set lat`, `set lon`
3. access commands such as `set guest.password` and `password`
4. WiFi commands
5. private key command
6. MQTT broker commands
7. `reboot`

`Apply Device + WiFi` sends the same sequence without MQTT commands.

`Apply MQTT` sends MQTT-only commands and then runs:

```text
mqtt reconnect
```

## Verification Behavior

Verification uses CLI readback through `get <key>` and `show mqtt`.

The app checks:

- radio values
- identity and location
- private key when set
- guest password
- WiFi values
- shared MQTT values
- per-broker enabled flag and settings
- `mqtt.connected`

If readback shows a mismatch, the UI builds a targeted retry plan and can re-send only
the unsaved commands.
