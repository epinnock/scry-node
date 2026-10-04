// test_driver/integration_test.dart - the host side of `flutter drive`: writes each screenshot to $SCRY_OUT/<id>.png.
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// The same shape scripts/make-scf.mjs accepts for a screen id (ID_SHAPE). The name becomes a file name, so a name like
/// `../../x` must never reach the file system.
final scryShotName = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

/// `<out>/<name>.png` for a valid screen name; throws ArgumentError (and so fails the drive) for anything else.
String scryShotPath(String out, String name) {
  if (!scryShotName.hasMatch(name)) {
    throw ArgumentError.value(name, 'screenshot name', 'must match ${scryShotName.pattern}');
  }
  return '$out/$name.png';
}

Future<void> main() => integrationDriver(
  onScreenshot: (name, bytes, [args]) async {
    final out = Platform.environment['SCRY_OUT'] ?? 'build/scry-it';
    final path = scryShotPath(out, name);
    Directory(out).createSync(recursive: true);
    File(path).writeAsBytesSync(bytes);
    return true;
  },
);
