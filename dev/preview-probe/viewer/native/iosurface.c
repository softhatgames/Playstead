// The preview probe's only native code, for the desktop shell on macOS: it
// looks up a game's global IOSurface by its ID, so Electron's experimental
// sharedTexture module can import it. Built with clang by run.mjs against
// Node-API, which Electron loads without rebuilding.
#include <IOSurface/IOSurface.h>
#include <node_api.h>

// lookup(id): the IOSurfaceRef as an 8-byte Buffer, as Electron's
// SharedTextureHandle.ioSurface expects, or null. The caller owns a reference
// and must pass the Buffer to release() when done.
static napi_value Lookup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t id = 0;
  napi_value result;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_get_value_uint32(env, argv[0], &id);
  IOSurfaceRef surface = IOSurfaceLookup(id);
  if (surface == NULL) {
    napi_get_null(env, &result);
    return result;
  }
  void *data;
  napi_create_buffer_copy(env, sizeof(surface), &surface, &data, &result);
  return result;
}

// release(buffer): drops the reference lookup() returned.
static napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void *data = NULL;
  size_t length = 0;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_get_buffer_info(env, argv[0], &data, &length);
  if (length == sizeof(IOSurfaceRef)) CFRelease(*(IOSurfaceRef *)data);
  return NULL;
}

NAPI_MODULE_INIT() {
  napi_value lookup, release;
  napi_create_function(env, "lookup", NAPI_AUTO_LENGTH, Lookup, NULL, &lookup);
  napi_create_function(env, "release", NAPI_AUTO_LENGTH, Release, NULL, &release);
  napi_set_named_property(env, exports, "lookup", lookup);
  napi_set_named_property(env, exports, "release", release);
  return exports;
}
