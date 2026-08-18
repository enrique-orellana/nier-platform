package integrations

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type S3API interface {
	ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

type S3Config struct {
	Endpoint       string
	Region         string
	AccessKey      string
	SecretKey      string
	ForcePathStyle bool
	Bucket         string
	SourceBucket   string
	PublicEndpoint string
	PublicURLBase  string
}

type SourceObject struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	LastModified string `json:"last_modified"`
}

type SourceObjectPage struct {
	Bucket                string         `json:"bucket"`
	Objects               []SourceObject `json:"objects"`
	NextContinuationToken string         `json:"next_continuation_token,omitempty"`
}

type S3Store struct {
	Client        S3API
	Bucket        string
	SourceBucket  string
	Presigner     *s3.PresignClient
	PublicURLBase string
}

func NewS3Store(ctx context.Context, config S3Config) (*S3Store, error) {
	if config.Region == "" {
		config.Region = "us-east-1"
	}
	options := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(config.Region)}
	if config.AccessKey != "" || config.SecretKey != "" {
		options = append(options, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(config.AccessKey, config.SecretKey, "")))
	}
	loaded, err := awsconfig.LoadDefaultConfig(ctx, options...)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(loaded, func(options *s3.Options) {
		options.UsePathStyle = config.ForcePathStyle
		if config.Endpoint != "" {
			options.BaseEndpoint = aws.String(config.Endpoint)
		}
	})
	publicEndpoint := config.PublicEndpoint
	if publicEndpoint == "" {
		publicEndpoint = config.Endpoint
	}
	publicClient := s3.NewFromConfig(loaded, func(options *s3.Options) {
		options.UsePathStyle = config.ForcePathStyle
		if publicEndpoint != "" {
			options.BaseEndpoint = aws.String(publicEndpoint)
		}
	})
	return &S3Store{
		Client:        client,
		Bucket:        config.Bucket,
		SourceBucket:  config.SourceBucket,
		Presigner:     s3.NewPresignClient(publicClient),
		PublicURLBase: config.PublicURLBase,
	}, nil
}

func (s *S3Store) DirectObjectURL(ctx context.Context, key string, expiration time.Duration) (string, error) {
	if s.Bucket == "" || key == "" {
		return "", fmt.Errorf("S3 object identity is required")
	}
	if s.Presigner != nil {
		if expiration <= 0 {
			expiration = 2 * time.Hour
		}
		request, err := s.Presigner.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(s.Bucket),
			Key:    aws.String(key),
		}, func(options *s3.PresignOptions) {
			options.Expires = expiration
		})
		if err != nil {
			return "", err
		}
		return request.URL, nil
	}
	if s.PublicURLBase != "" {
		return strings.TrimRight(s.PublicURLBase, "/") + "/" + s.Bucket + "/" + strings.TrimLeft(key, "/"), nil
	}
	return "", fmt.Errorf("S3 public endpoint is not configured")
}

func (s *S3Store) ListSourceObjects(ctx context.Context, search string, limit int, continuation string) (SourceObjectPage, error) {
	if s.Client == nil || s.SourceBucket == "" {
		return SourceObjectPage{}, fmt.Errorf("S3 source store is not configured")
	}
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	search = strings.ToLower(strings.TrimSpace(search))
	page := SourceObjectPage{Bucket: s.SourceBucket, Objects: make([]SourceObject, 0, limit)}
	token := continuation
	for len(page.Objects) < limit {
		input := &s3.ListObjectsV2Input{Bucket: aws.String(s.SourceBucket), MaxKeys: int32Ptr(int32(limit))}
		if token != "" {
			input.ContinuationToken = aws.String(token)
		}
		output, err := s.Client.ListObjectsV2(ctx, input)
		if err != nil {
			return SourceObjectPage{}, err
		}
		for _, object := range output.Contents {
			key := aws.ToString(object.Key)
			if search != "" && !strings.Contains(strings.ToLower(key), search) {
				continue
			}
			lastModified := ""
			if object.LastModified != nil {
				lastModified = object.LastModified.UTC().Format(time.RFC3339Nano)
			}
			page.Objects = append(page.Objects, SourceObject{Key: key, Name: path.Base(key), Size: aws.ToInt64(object.Size), LastModified: lastModified})
			if len(page.Objects) == limit {
				break
			}
		}
		if !aws.ToBool(output.IsTruncated) || output.NextContinuationToken == nil {
			break
		}
		token = aws.ToString(output.NextContinuationToken)
		if token == "" {
			break
		}
	}
	if token != "" {
		page.NextContinuationToken = token
	}
	return page, nil
}

func (s *S3Store) DeletePrefix(ctx context.Context, prefix string) (int, error) {
	if s.Client == nil || s.Bucket == "" {
		return 0, fmt.Errorf("S3 store is not configured")
	}
	if prefix == "" {
		return 0, fmt.Errorf("S3 delete prefix is required")
	}
	deleted := 0
	var token *string
	for {
		input := &s3.ListObjectsV2Input{Bucket: aws.String(s.Bucket), Prefix: aws.String(prefix), MaxKeys: int32Ptr(1000), ContinuationToken: token}
		output, err := s.Client.ListObjectsV2(ctx, input)
		if err != nil {
			return deleted, err
		}
		if len(output.Contents) > 0 {
			identifiers := make([]types.ObjectIdentifier, 0, len(output.Contents))
			for _, object := range output.Contents {
				identifiers = append(identifiers, types.ObjectIdentifier{Key: object.Key})
			}
			response, err := s.Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{Bucket: aws.String(s.Bucket), Delete: &types.Delete{Objects: identifiers, Quiet: aws.Bool(false)}})
			if err != nil {
				return deleted, err
			}
			deleted += len(response.Deleted)
		}
		if !aws.ToBool(output.IsTruncated) || output.NextContinuationToken == nil {
			break
		}
		token = output.NextContinuationToken
	}
	return deleted, nil
}

func (s *S3Store) DownloadSourceObject(ctx context.Context, bucket, key, destination string, maxBytes int64) error {
	if s.Client == nil || s.SourceBucket == "" {
		return fmt.Errorf("S3 source store is not configured")
	}
	if bucket != s.SourceBucket || key == "" || strings.Contains(key, "\\") || strings.Contains(key, "..") {
		return fmt.Errorf("invalid source object")
	}
	output, err := s.Client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return err
	}
	defer output.Body.Close()
	if maxBytes <= 0 {
		maxBytes = 16 * 1024 * 1024 * 1024
	}
	if output.ContentLength != nil && *output.ContentLength > maxBytes {
		return fmt.Errorf("source object exceeds configured file size limit")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".source-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	limited := io.LimitReader(output.Body, maxBytes+1)
	written, err := io.Copy(temporary, limited)
	if err != nil {
		_ = temporary.Close()
		return err
	}
	if written > maxBytes {
		_ = temporary.Close()
		return fmt.Errorf("source object exceeds configured file size limit")
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, destination)
}

func int32Ptr(value int32) *int32 { return &value }
