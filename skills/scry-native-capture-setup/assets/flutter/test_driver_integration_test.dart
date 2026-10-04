// test_driver/integration_test.dart - the host side of `flutter drive`: writes each screenshot to $SCRY_OUT/<id>.png.
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() => integrationDriver(
  onScreenshot: (name, bytes, [args]) async {
    final out = Platform.environment['SCRY_OUT'] ?? 'build/scry-it';
    Directory(out).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(bytes);
    return true;
  },
);
