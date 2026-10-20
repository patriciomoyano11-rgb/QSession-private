cmake_minimum_required(VERSION 3.25)

project(qsession_windows_native VERSION 0.1.0 LANGUAGES CXX)

option(QSESSION_BUILD_TESTS "Build the native QSession test suite" ON)

if(WIN32)
    list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
    include(LiveKitSDK)
    qsession_livekit_sdk_setup()
    find_package(LiveKit CONFIG REQUIRED)
endif()

add_library(qsession_audio_core STATIC
    src/audio_pipeline.cpp
)

target_include_directories(qsession_audio_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(qsession_audio_core PUBLIC cxx_std_20)

if(MSVC)
    target_compile_options(qsession_audio_core PRIVATE /W4 /WX /permissive-)
else()
    target_compile_options(qsession_audio_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(qsession_audio_probe
    src/main.cpp
)
target_link_libraries(qsession_audio_probe PRIVATE qsession_audio_core)

if(WIN32)
    add_library(qsession_wasapi SHARED
        src/wasapi_capture.cpp
        src/camera_capture.cpp
        src/livekit_publisher.cpp
    )
    target_include_directories(qsession_wasapi
        PUBLIC
            ${CMAKE_CURRENT_SOURCE_DIR}/include
    )
    target_compile_features(qsession_wasapi PUBLIC cxx_std_20)
    target_compile_definitions(qsession_wasapi
        PRIVATE
            QSESSION_WASAPI_EXPORTS
            UNICODE
            _UNICODE
            NOMINMAX
    )
    target_link_libraries(qsession_wasapi PRIVATE qsession_audio_core LiveKit::livekit ole32 uuid mf mfplat mfreadwrite mfuuid)
    set_target_properties(qsession_wasapi PROPERTIES OUTPUT_NAME "QSession.Audio")

    add_custom_command(TARGET qsession_wasapi POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${QSESSION_LIVEKIT_ROOT}/bin/livekit.dll"
            "$<TARGET_FILE_DIR:qsession_wasapi>/livekit.dll"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${QSESSION_LIVEKIT_ROOT}/bin/livekit_ffi.dll"
            "$<TARGET_FILE_DIR:qsession_wasapi>/livekit_ffi.dll")

    add_executable(qsession_wasapi_probe
        src/wasapi_probe.cpp
    )
    target_compile_definitions(qsession_wasapi_probe PRIVATE UNICODE _UNICODE)
    target_link_libraries(qsession_wasapi_probe PRIVATE qsession_wasapi)

    if(MSVC)
        target_compile_options(qsession_wasapi PRIVATE /W4 /WX /permissive-)
        target_compile_options(qsession_wasapi_probe PRIVATE /W4 /WX /permissive-)
    endif()
endif()

if(QSESSION_BUILD_TESTS)
    include(CTest)
    add_executable(qsession_audio_core_tests
        tests/audio_pipeline_tests.cpp
    )
    target_link_libraries(qsession_audio_core_tests PRIVATE qsession_audio_core)

    if(MSVC)
        target_compile_options(qsession_audio_core_tests PRIVATE /W4 /WX /permissive-)
    else()
        target_compile_options(qsession_audio_core_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    endif()

    add_test(NAME qsession_audio_core_tests COMMAND qsession_audio_core_tests)

    if(WIN32)
        add_test(NAME qsession_wasapi_enumeration COMMAND qsession_wasapi_probe --list)
        add_test(NAME qsession_wasapi_input_enumeration COMMAND qsession_wasapi_probe --list-inputs)
        add_test(NAME qsession_camera_enumeration COMMAND qsession_wasapi_probe --list-cameras)
    endif()
endif()
