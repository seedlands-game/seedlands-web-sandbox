package utils_test

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	providerutils "github.com/maximhq/bifrost/core/providers/utils"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

func TestCompatibilityProbeFastHTTPPeerCloseDoesNotCancelRequestContext(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	observed := make(chan bool, 1)
	server := &fasthttp.Server{Handler: func(ctx *fasthttp.RequestCtx) {
		close(started)
		select {
		case <-ctx.Done():
			observed <- true
		case <-time.After(250 * time.Millisecond):
			observed <- false
		}
		ctx.SetBodyString("done")
	}}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()

	connection, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	writer := bufio.NewWriter(connection)
	if _, err := fmt.Fprint(writer, "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	<-started
	_ = connection.Close()
	if <-observed {
		t.Fatal("fasthttp RequestCtx.Done unexpectedly observed the peer disconnect")
	}
	if err := server.Shutdown(); err != nil {
		t.Fatal(err)
	}
	<-serveDone
}

func TestCompatibilityProbeProviderContextCancelDoesNotStopFastHTTPDo(t *testing.T) {
	backendFinished := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		time.Sleep(400 * time.Millisecond)
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte(`{"ok":true}`))
		close(backendFinished)
	}))
	defer backend.Close()

	request := fasthttp.AcquireRequest()
	response := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(request)
	defer fasthttp.ReleaseResponse(response)
	request.SetRequestURI(backend.URL)
	request.Header.SetMethod(http.MethodGet)
	client := &fasthttp.Client{ReadTimeout: 2 * time.Second}
	bifrostContext, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)

	startedAt := time.Now()
	_, bifrostError, wait := providerutils.MakeRequestWithContext(bifrostContext, client, request, response)
	if bifrostError == nil || bifrostError.StatusCode == nil || *bifrostError.StatusCode != 499 {
		t.Fatalf("cancel result = %#v, want status 499", bifrostError)
	}
	returnedAt := time.Since(startedAt)
	waitStartedAt := time.Now()
	wait()
	waited := time.Since(waitStartedAt)
	<-backendFinished
	if returnedAt > 200*time.Millisecond {
		t.Fatalf("context cancellation returned after %v, want prompt local return", returnedAt)
	}
	if waited < 250*time.Millisecond {
		t.Fatalf("underlying fasthttp request wait = %v, want evidence it continued", waited)
	}
}
